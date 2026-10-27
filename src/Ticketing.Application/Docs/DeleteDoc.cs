using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Soft-deletes a doc and, for a folder, its whole subtree as one group sharing <c>DeletedRootId</c> (spec 1.5, 1.6, D-82).
/// Owners delete anything; Members only nodes they created (<c>doc.delete.forbidden</c>), folders only when empty
/// (<c>doc.folder.notEmpty</c>). Versions, drafts and attachments are kept; <see cref="RestoreDoc"/> undoes it.
/// </summary>
public static class DeleteDoc
{
    public const string Action = "doc.deleted";

    public sealed record Command(string KeyOrId);

    /// <param name="DeletedCount">Nodes deleted, the doc itself included.</param>
    /// <param name="UndoUntil">Until when the deleter can restore it (Owners can restore from the trash at any time).</param>
    public sealed record Result(Guid Id, string Key, int DeletedCount, DateTimeOffset DeletedAt, DateTimeOffset UndoUntil);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, Result>
    {
        public async Task<Result> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await DocLookup.WriteAsync(db, access, command.KeyOrId, cancellationToken);
            return await db.InTransactionAsync(
                async ct =>
                {
                    var shape = await DocTree.LockAsync(db, target.ProjectId, ct);
                    var node = await DocTree.LockNodeAsync(db, target.Id, ct);
                    var descendants = shape.DescendantsOf(node.Id);
                    EnsureCanDelete(target, node, descendants.Count);

                    var now = clock.Now;
                    var me = currentUser.Id;
                    var rootId = node.Id;
                    node.Delete(me, now, rootId);
                    if (descendants.Count > 0)
                    {
                        var ids = descendants.ToArray();
                        await db.DocNodes
                            .Where(n => ids.Contains(n.Id) && n.DeletedAt == null)
                            .ExecuteUpdateAsync(
                                s => s.SetProperty(n => n.DeletedAt, now).SetProperty(n => n.DeletedById, me).SetProperty(n => n.DeletedRootId, rootId), ct);
                    }
                    var count = descendants.Count + 1;
                    activity.Record(ActivityEntityType.Doc, node.Id, node.ProjectId, Action, new { key = target.Key, deletedRootId = rootId, count });
                    await db.SaveChangesAsync(ct);
                    return new Result(node.Id, target.Key, count, now, now + DocNode.RestoreWindow);
                },
                cancellationToken);
        }

        private void EnsureCanDelete(DocTarget target, DocNode node, int descendantCount)
        {
            if (target.Grant.IsOwner)
                return;
            if (node.CreatedById != currentUser.Id)
                throw AppException.Forbidden(
                    DocErrors.DeleteForbidden, $"Only project owners can delete docs created by someone else ({target.Key}).",
                    "Ask a project owner to delete it.");
            if (node.IsFolder && descendantCount > 0)
                throw AppException.Conflict(
                    DocErrors.FolderNotEmpty, $"{target.Key} is not empty; Members can only delete empty folders.",
                    "Move or delete its docs first, or ask a project owner.");
        }
    }
}
