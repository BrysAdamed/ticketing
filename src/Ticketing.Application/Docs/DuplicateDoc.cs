using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Docs;

/// <summary>
/// Copies a page or diagram's latest title and content into a new doc right after it, titled "Copy of …" (with " (2)"…
/// on a clash), starting at version 1 (spec 1.4). Folders cannot be duplicated.
/// </summary>
public static class DuplicateDoc
{
    public sealed record Command(string KeyOrId);

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        IProjectCounters counters,
        ITicketRanker ranker,
        DocPublisher publisher) : IHandler<Command, DocDto>
    {
        public async Task<DocDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var source = await DocLookup.WriteAsync(db, access, command.KeyOrId, cancellationToken);
            var grant = source.Grant;
            var copy = await db.InTransactionAsync(
                async ct =>
                {
                    var shape = await DocTree.LockAsync(db, grant.ProjectId, ct);
                    var original = await db.DocNodes.AsNoTracking().SingleAsync(n => n.Id == source.Id, ct);
                    original.EnsureHasContent();
                    shape.EnsureCanAdd(original.ParentId);

                    var title = DocTitles.CopyOf(original.Title, await DocTree.SiblingTitlesAsync(db, grant.ProjectId, original.ParentId, null, ct));
                    var rank = (await ranker.PlaceManyAsync(
                        RankContainer.DocFolder(grant.ProjectId, original.ParentId), RankAnchor.After(original.Id), 1, [], ct))[0];
                    var number = await counters.NextAsync(grant.ProjectId, CounterKind.Doc, ct);
                    var node = DocNode.CreateDocument(
                        grant.ProjectId, number, original.Kind, original.DiagramFormat, original.ParentId, rank, title, original.Content, currentUser.Id, clock.Now);
                    node.SetOutline(original.Outline);
                    db.DocNodes.Add(node);
                    publisher.AddInitialVersion(
                        node, string.Create(CultureInfo.InvariantCulture, $"Duplicated from {source.Key} v{original.CurrentVersion}"));
                    activity.Record(ActivityEntityType.Doc, node.Id, grant.ProjectId, CreateDoc.Action, new
                    {
                        key = node.KeyIn(grant.ProjectKey),
                        node.Kind,
                        node.DiagramFormat,
                        node.Title,
                        parentKey = await DocTree.KeyOfAsync(db, grant, node.ParentId, ct),
                        duplicatedFrom = source.Key,
                    });
                    await DocTree.SaveAsync(db, title, ct);
                    return new DocTarget(node.Id, node.ProjectId, node.Number, node.Kind, grant);
                },
                cancellationToken);
            return await DocQueries.LoadAsync(db, currentUser, clock, copy, cancellationToken);
        }
    }
}
