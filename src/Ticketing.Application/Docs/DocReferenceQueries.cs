using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Reads the reference index (<c>doc_references</c>) for one reader: what a doc mentions, which diagrams it embeds, and which
/// docs mention a doc or a ticket. Every query is composed with <see cref="IProjectAccess.ReadableProjects"/>, so a ticket or
/// doc the reader cannot read is simply absent (spec 1.5).
/// </summary>
public static class DocReferenceQueries
{
    public const int DocBacklinksLimit = 50;

    public static async Task<(DocReferencesDto References, IReadOnlyList<DocEmbedDto> Embeds)> ReferencesAsync(
        ITicketingDbContext db, IProjectAccess access, Guid nodeId, string? content, DocKind kind, DiagramFormat? format, CancellationToken cancellationToken)
    {
        if (kind == DocKind.Folder)
            return (DocReferencesDto.Empty, []);

        var readable = access.ReadableProjects();
        var tickets = await (
                from r in db.DocReferences.AsNoTracking()
                where r.SourceNodeId == nodeId && r.TargetType == DocReferenceTarget.Ticket
                join t in db.Tickets on r.TargetId equals t.Id
                where t.DeletedAt == null && readable.Any(p => p.Id == t.ProjectId)
                join p in db.Projects on t.ProjectId equals p.Id
                orderby p.Key, t.Number
                select new { t.Id, ProjectKey = p.Key, t.Number, t.Title, t.Type, t.Status })
            .ToListAsync(cancellationToken);
        var docs = await (
                from r in db.DocReferences.AsNoTracking()
                where r.SourceNodeId == nodeId && r.TargetType == DocReferenceTarget.Doc
                join n in db.DocNodes on r.TargetId equals n.Id
                where readable.Any(p => p.Id == n.ProjectId)
                join p in db.Projects on n.ProjectId equals p.Id
                orderby p.Key, n.Number
                select new { n.Id, ProjectKey = p.Key, n.Number, n.Kind, n.DiagramFormat, n.Title, n.CurrentVersion, Deleted = n.DeletedAt != null })
            .ToListAsync(cancellationToken);

        var references = new DocReferencesDto(
            [.. tickets.Select(t =>
            {
                var key = HumanKeys.Ticket(t.ProjectKey, t.Number);
                return new DocTicketReferenceDto(t.Id, key, t.Title, t.Type, t.Status, TicketQueries.Url(key));
            })],
            [.. docs.Select(d =>
            {
                var key = HumanKeys.Doc(d.ProjectKey, d.Number);
                return d.Deleted
                    ? new DocLinkReferenceDto(d.Id, key, d.ProjectKey, d.Kind, d.DiagramFormat, null, true, null)
                    : new DocLinkReferenceDto(d.Id, key, d.ProjectKey, d.Kind, d.DiagramFormat, d.Title, false, DocQueries.Url(d.ProjectKey, key, d.Title));
            })]);

        var embedKeys = DocReferenceParser.Parse(content, kind, format).Embeds;
        if (embedKeys.Count == 0)
            return (references, []);
        var diagrams = docs
            .Where(d => !d.Deleted && d.Kind == DocKind.Diagram)
            .ToDictionary(d => new DocKeyReference(d.ProjectKey, d.Number));
        var embedded = embedKeys.Where(diagrams.ContainsKey).Select(k => diagrams[k]).ToList();
        var mermaidIds = embedded.Where(d => d.DiagramFormat == DiagramFormat.Mermaid).Select(d => d.Id).Distinct().ToList();
        var sources = mermaidIds.Count == 0
            ? []
            : await db.DocNodes.AsNoTracking()
                .Where(n => mermaidIds.Contains(n.Id))
                .Select(n => new { n.Id, n.Content })
                .ToDictionaryAsync(n => n.Id, n => n.Content, cancellationToken);
        var canvasIds = embedded.Where(d => d.DiagramFormat == DiagramFormat.Canvas).Select(d => d.Id).Distinct().ToList();
        var pictured = canvasIds.Count == 0
            ? []
            : await (
                    from v in db.DocVersions.AsNoTracking()
                    join n in db.DocNodes on v.NodeId equals n.Id
                    where canvasIds.Contains(n.Id) && v.Number == n.CurrentVersion && v.SnapshotSvg != null
                    select n.Id)
                .ToHashSetAsync(cancellationToken);
        return (references, [.. embedded.Select(d =>
        {
            var key = HumanKeys.Doc(d.ProjectKey, d.Number);
            return new DocEmbedDto(
                d.Id, key, d.ProjectKey, d.Title, d.DiagramFormat!.Value, d.CurrentVersion, sources.GetValueOrDefault(d.Id),
                DocQueries.Url(d.ProjectKey, key, d.Title))
            {
                SnapshotUrl = pictured.Contains(d.Id) ? DocQueries.SnapshotUrl(key, d.CurrentVersion) : null,
            };
        })]);
    }

    /// <summary>Readable, non-deleted docs whose latest content mentions the target, most recently updated first.</summary>
    public static async Task<DocMentionsDto> MentioningAsync(
        ITicketingDbContext db, IProjectAccess access, DocReferenceTarget targetType, Guid targetId, int limit, CancellationToken cancellationToken)
    {
        var readable = access.ReadableProjects();
        var sources =
            from r in db.DocReferences.AsNoTracking()
            where r.TargetType == targetType && r.TargetId == targetId
            join n in db.DocNodes on r.SourceNodeId equals n.Id
            where n.DeletedAt == null && readable.Any(p => p.Id == n.ProjectId)
            select n;
        var total = await sources.CountAsync(cancellationToken);
        if (total == 0)
            return DocMentionsDto.Empty;

        var rows = await (
                from n in sources
                join p in db.Projects on n.ProjectId equals p.Id
                join u in db.Users on n.UpdatedById equals u.Id
                orderby n.UpdatedAt descending, n.Id descending
                select new
                {
                    n.Id, n.ProjectId, ProjectKey = p.Key, n.Number, n.Kind, n.DiagramFormat, n.Title, n.ParentId, n.CurrentVersion, n.UpdatedAt,
                    UserId = u.Id, u.Email, u.DisplayName, u.IsActive,
                })
            .Take(limit)
            .ToListAsync(cancellationToken);

        var folders = new Dictionary<Guid, DocFolderIndex>();
        foreach (var projectId in rows.Select(r => r.ProjectId).Distinct())
            folders[projectId] = await DocQueries.FoldersAsync(db, projectId, includeDeleted: false, cancellationToken);

        return new DocMentionsDto(total, [.. rows.Select(r =>
        {
            var key = HumanKeys.Doc(r.ProjectKey, r.Number);
            return new DocSummaryDto(
                r.Id, key, r.ProjectKey, r.Kind, r.DiagramFormat, r.Title, folders[r.ProjectId].PathOf(r.ParentId, r.Title), r.CurrentVersion,
                new UserRefDto(r.UserId, r.Email, r.DisplayName, r.IsActive), r.UpdatedAt, DocQueries.Url(r.ProjectKey, key, r.Title));
        })]);
    }
}
