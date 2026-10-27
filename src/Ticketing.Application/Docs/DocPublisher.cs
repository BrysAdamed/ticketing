using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// The one place a page or diagram version is written (create, update, find/replace edits, duplicate, and later version
/// restore). Publishing advances the node, snapshots a <see cref="DocVersion"/>, drops the publisher's own draft and records
/// <c>doc.updated</c>. Work that must follow every publish (reference index, Canvas outline) belongs here. The caller saves.
/// </summary>
public sealed class DocPublisher(ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IActivityLog activity)
{
    public const string UpdatedAction = "doc.updated";

    /// <summary>Publishes <paramref name="content"/> as the next version of a tracked, row-locked node.</summary>
    public async Task PublishAsync(DocNode node, string? content, string? changeNote, int? restoredFrom, CancellationToken cancellationToken)
    {
        node.Publish(content, currentUser.Id, clock.Now);
        db.DocVersions.Add(DocVersion.Snapshot(node, changeNote, currentUser.Id, currentUser.Channel, clock.Now, restoredFrom));
        await DiscardMyDraftAsync(node.Id, cancellationToken);
        activity.Record(ActivityEntityType.Doc, node.Id, node.ProjectId, UpdatedAction, node.CurrentVersion);
    }

    /// <summary>Snapshots version 1 of a node just created with its content.</summary>
    public void AddInitialVersion(DocNode node, string? changeNote) =>
        db.DocVersions.Add(DocVersion.Snapshot(node, changeNote, currentUser.Id, currentUser.Channel, clock.Now));

    public Task<int> DiscardMyDraftAsync(Guid nodeId, CancellationToken cancellationToken)
    {
        var me = currentUser.Id;
        return db.DocDrafts.Where(d => d.NodeId == nodeId && d.UserId == me).ExecuteDeleteAsync(cancellationToken);
    }
}
