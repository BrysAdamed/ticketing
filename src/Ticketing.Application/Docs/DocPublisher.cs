using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// The one place a page or diagram version is written (create, update, find/replace edits, duplicate, version restore).
/// Publishing advances the node, snapshots a <see cref="DocVersion"/>, rebuilds the node's reference index
/// (<see cref="DocReference"/>), drops the publisher's own draft and records <c>doc.updated</c>. A restore records <c>doc.version.restored</c> instead and keeps the draft: it was not published, and
/// the editor merges it onto the restored version like onto any newer one. Work that must follow every publish (Canvas
/// outline) belongs here. The caller saves.
/// </summary>
public sealed class DocPublisher(ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IActivityLog activity)
{
    public const string UpdatedAction = "doc.updated";
    public const string VersionRestoredAction = "doc.version.restored";

    /// <summary>
    /// Publishes <paramref name="content"/> as the next version of a tracked, row-locked node. A Canvas source is validated
    /// (<see cref="CanvasSource"/>) and its outline stored; <paramref name="snapshotSvg"/> is the Canvas picture of exactly this
    /// content (Canvas only, optional).
    /// </summary>
    public async Task PublishAsync(
        DocNode node, string? content, string? changeNote, int? restoredFrom, string? snapshotSvg, CancellationToken cancellationToken)
    {
        node.Publish(content, currentUser.Id, clock.Now);
        var snapshot = ApplyDiagramRules(node, snapshotSvg);
        db.DocVersions.Add(DocVersion.Snapshot(node, changeNote, currentUser.Id, currentUser.Channel, clock.Now, restoredFrom, snapshot));
        await IndexReferencesAsync(node, isNew: false, cancellationToken);
        if (restoredFrom is null)
        {
            await DiscardMyDraftAsync(node.Id, cancellationToken);
            activity.Record(ActivityEntityType.Doc, node.Id, node.ProjectId, UpdatedAction, node.CurrentVersion);
        }
        else
        {
            activity.Record(ActivityEntityType.Doc, node.Id, node.ProjectId, VersionRestoredAction, new { version = node.CurrentVersion, restoredFrom });
        }
    }

    /// <summary>Snapshots version 1 of a node just created with its content (Canvas: validated, with outline and optional picture) and indexes its references.</summary>
    public async Task AddInitialVersionAsync(DocNode node, string? changeNote, string? snapshotSvg, CancellationToken cancellationToken)
    {
        var snapshot = ApplyDiagramRules(node, snapshotSvg);
        db.DocVersions.Add(DocVersion.Snapshot(node, changeNote, currentUser.Id, currentUser.Channel, clock.Now, snapshotSvg: snapshot));
        await IndexReferencesAsync(node, isNew: true, cancellationToken);
    }

    /// <summary>
    /// Stores the Canvas picture of version <paramref name="number"/> when it has none yet (versions written over MCP), without
    /// creating a version; the first picture stored wins. Returns false when the version already had one.
    /// </summary>
    public async Task<bool> AttachSnapshotAsync(Guid nodeId, int number, string snapshotSvg, CancellationToken cancellationToken)
    {
        var svg = CanvasSnapshot.Normalize(snapshotSvg);
        var updated = await db.DocVersions
            .Where(v => v.NodeId == nodeId && v.Number == number && v.SnapshotSvg == null)
            .ExecuteUpdateAsync(s => s.SetProperty(v => v.SnapshotSvg, svg), cancellationToken);
        return updated > 0;
    }

    /// <summary>Canvas: validates the source, stores the outline and checks the picture. Other kinds take no picture.</summary>
    private static string? ApplyDiagramRules(DocNode node, string? snapshotSvg)
    {
        if (!node.IsCanvas)
        {
            if (snapshotSvg is not null)
                throw DomainException.Invalid("snapshot", DocErrors.KindUnsupported, "Only Canvas diagrams have a snapshot.");
            return null;
        }
        node.SetOutline(CanvasSource.Validate(node.Content).ToText());
        return snapshotSvg is null ? null : CanvasSnapshot.Normalize(snapshotSvg);
    }

    public Task<int> DiscardMyDraftAsync(Guid nodeId, CancellationToken cancellationToken)
    {
        var me = currentUser.Id;
        return db.DocDrafts.Where(d => d.NodeId == nodeId && d.UserId == me).ExecuteDeleteAsync(cancellationToken);
    }

    /// <summary>
    /// Rebuilds the node's rows in <c>doc_references</c> from its latest content: every existing ticket and doc (deleted ones
    /// included, so a restore needs no re-index) whose key the content mentions, in any project; unknown keys and the node
    /// itself are skipped. Readers filter the index by what they can read.
    /// </summary>
    private async Task IndexReferencesAsync(DocNode node, bool isNew, CancellationToken cancellationToken)
    {
        var keys = DocReferenceParser.Parse(node.Content, node.Kind, node.DiagramFormat);
        var targets = await ResolveAsync(keys, node.Id, cancellationToken);
        var existing = isNew
            ? []
            : await db.DocReferences.AsNoTracking()
                .Where(r => r.SourceNodeId == node.Id)
                .Select(r => new DocReferenceTargetKey(r.TargetType, r.TargetId))
                .ToListAsync(cancellationToken);

        var stale = existing.Except(targets).Select(t => t.Id).ToList();
        if (stale.Count > 0)
        {
            var nodeId = node.Id;
            await db.DocReferences.Where(r => r.SourceNodeId == nodeId && stale.Contains(r.TargetId)).ExecuteDeleteAsync(cancellationToken);
        }
        foreach (var target in targets.Except(existing))
            db.DocReferences.Add(DocReference.Create(node.Id, target.Type, target.Id));
    }

    private async Task<HashSet<DocReferenceTargetKey>> ResolveAsync(DocContentKeys keys, Guid sourceId, CancellationToken cancellationToken)
    {
        var result = new HashSet<DocReferenceTargetKey>();
        if (keys.Tickets.Count == 0 && keys.Docs.Count == 0)
            return result;

        var projectKeys = keys.Tickets.Concat(keys.Docs).Select(k => k.ProjectKey).Distinct().ToList();
        var projects = await db.Projects.AsNoTracking()
            .Where(p => projectKeys.Contains(p.Key))
            .Select(p => new { p.Id, p.Key })
            .ToDictionaryAsync(p => p.Id, p => p.Key, cancellationToken);
        var projectIds = projects.Keys.ToList();

        if (keys.Tickets.Count > 0)
        {
            var wanted = keys.Tickets.ToHashSet();
            var numbers = keys.Tickets.Select(k => k.Number).Distinct().ToList();
            var tickets = await db.Tickets.AsNoTracking()
                .Where(t => projectIds.Contains(t.ProjectId) && numbers.Contains(t.Number))
                .Select(t => new { t.Id, t.ProjectId, t.Number })
                .ToListAsync(cancellationToken);
            foreach (var ticket in tickets.Where(t => wanted.Contains(new DocKeyReference(projects[t.ProjectId], t.Number))))
                result.Add(new DocReferenceTargetKey(DocReferenceTarget.Ticket, ticket.Id));
        }

        if (keys.Docs.Count > 0)
        {
            var wanted = keys.Docs.ToHashSet();
            var numbers = keys.Docs.Select(k => k.Number).Distinct().ToList();
            var docs = await db.DocNodes.AsNoTracking()
                .Where(n => n.Id != sourceId && projectIds.Contains(n.ProjectId) && numbers.Contains(n.Number))
                .Select(n => new { n.Id, n.ProjectId, n.Number })
                .ToListAsync(cancellationToken);
            foreach (var doc in docs.Where(d => wanted.Contains(new DocKeyReference(projects[d.ProjectId], d.Number))))
                result.Add(new DocReferenceTargetKey(DocReferenceTarget.Doc, doc.Id));
        }
        return result;
    }

    private sealed record DocReferenceTargetKey(DocReferenceTarget Type, Guid Id);
}
