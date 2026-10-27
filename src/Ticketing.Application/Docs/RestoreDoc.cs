using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Restores a deleted doc together with everything deleted with it (its delete group, spec 1.6). The deleter can undo
/// within 10 minutes, Owners at any time (trash). The group goes back to its former folder when that is still there,
/// otherwise to the root; on a title clash the restored doc gets " (restored)". Its drafts come back with it.
/// </summary>
public static class RestoreDoc
{
    public const string Action = "doc.restored";

    public sealed record Command(string KeyOrId);

    public sealed class Handler(
        ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity, ITicketRanker ranker)
        : IHandler<Command, DocDto>
    {
        public async Task<DocDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await DocLookup.WriteIncludingDeletedAsync(db, access, command.KeyOrId, cancellationToken);
            var root = await db.InTransactionAsync(ct => RestoreAsync(target, ct), cancellationToken);
            return await DocQueries.LoadAsync(db, access, currentUser, clock, root, cancellationToken);
        }

        private async Task<DocTarget> RestoreAsync(DocTarget target, CancellationToken cancellationToken)
        {
            var shape = await DocTree.LockAsync(db, target.ProjectId, cancellationToken);
            var targetId = target.Id;
            var rootId = await db.DocNodes.Where(n => n.Id == targetId).Select(n => n.DeletedRootId).SingleAsync(cancellationToken)
                ?? throw AppException.Conflict(DocErrors.NotDeleted, $"{target.Key} is not deleted.");
            var root = await DocTree.LockNodeAsync(db, rootId, cancellationToken);
            EnsureCanRestore(target, root);

            var group = await db.DocNodes.AsNoTracking()
                .Where(n => n.DeletedRootId == rootId)
                .Select(n => new DocTreeNode(n.Id, n.Id == rootId ? null : n.ParentId, n.Kind))
                .ToListAsync(cancellationToken);
            var parentId = root.ParentId is { } formerParent && shape.Contains(formerParent) ? formerParent : (Guid?)null;
            shape.EnsureCanAdd(parentId, group.Count, new DocTreeShape(group).HeightOf(rootId));

            var oldTitle = root.Title;
            var title = DocTitles.Restored(oldTitle, await DocTree.SiblingTitlesAsync(db, root.ProjectId, parentId, root.Id, cancellationToken));
            var rank = await ranker.ReuseOrPlaceAsync(RankContainer.DocFolder(root.ProjectId, parentId), root.Rank, RankAnchor.Bottom, [root.Id], cancellationToken);
            await db.DocNodes
                .Where(n => n.DeletedRootId == rootId && n.Id != rootId)
                .ExecuteUpdateAsync(
                    s => s.SetProperty(n => n.DeletedAt, (DateTimeOffset?)null)
                        .SetProperty(n => n.DeletedById, (Guid?)null)
                        .SetProperty(n => n.DeletedRootId, (Guid?)null),
                    cancellationToken);
            root.Restore(parentId, rank, title);

            var key = root.KeyIn(target.Grant.ProjectKey);
            activity.Record(ActivityEntityType.Doc, root.Id, root.ProjectId, Action, new
            {
                key,
                count = group.Count,
                parentKey = await DocTree.KeyOfAsync(db, target.Grant, parentId, cancellationToken),
                title = title == oldTitle ? null : title,
            });
            await DocTree.SaveAsync(db, title, cancellationToken);
            return new DocTarget(root.Id, root.ProjectId, root.Number, root.Kind, target.Grant);
        }

        private void EnsureCanRestore(DocTarget target, DocNode root)
        {
            if (target.Grant.IsOwner)
                return;
            var rootKey = root.KeyIn(target.Grant.ProjectKey);
            if (root.DeletedById != currentUser.Id)
                throw AppException.Forbidden(
                    DocErrors.RestoreForbidden, $"Only the person who deleted {rootKey} or a project owner can restore it.",
                    "Ask a project owner to restore it from the trash.");
            if (!root.CanBeUndoneAt(clock.Now))
                throw AppException.Conflict(
                    DocErrors.RestoreExpired,
                    string.Create(CultureInfo.InvariantCulture, $"A delete can only be undone within {DocNode.RestoreWindowMinutes} minutes."),
                    "Ask a project owner to restore it from the trash.");
        }
    }
}
