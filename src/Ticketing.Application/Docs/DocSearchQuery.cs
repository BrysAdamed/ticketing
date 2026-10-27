using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Turns <see cref="DocSearchCriteria"/> into a query over the caller's readable, non-deleted docs (never drafts: only the
/// published copy on <c>doc_nodes</c> is searched), ranks it, and loads result rows with snippets. Shared by docs search and
/// the command palette's quick jump.
/// </summary>
internal sealed class DocSearchQuery(ITicketingDbContext db, IProjectAccess access)
{
    private const int MinTrigramLength = 3;

    public async Task<DocSearchScope> BuildAsync(DocSearchCriteria criteria, CancellationToken cancellationToken)
    {
        var readable = access.ReadableProjects().AsNoTracking();
        if (criteria.ProjectKeys.Count > 0)
        {
            var keys = criteria.ProjectKeys;
            readable = readable.Where(p => keys.Contains(p.Key));
        }
        var projects = await readable.Select(p => new { p.Id, p.Key }).ToListAsync(cancellationToken);
        var projectIds = projects.Select(p => p.Id).ToList();

        var nodes = db.DocNodes.AsNoTracking().Where(n => n.DeletedAt == null && projectIds.Contains(n.ProjectId));
        if (criteria.Kinds.Count > 0)
        {
            var kinds = criteria.Kinds;
            nodes = nodes.Where(n => kinds.Contains(n.Kind));
        }
        if (criteria.Updated.From is { } from)
            nodes = nodes.Where(n => n.UpdatedAt >= from);
        if (criteria.Updated.To is { } to)
            nodes = nodes.Where(n => n.UpdatedAt < to);
        nodes = await ApplyFolderAsync(nodes, criteria.Folder, projectIds, cancellationToken);
        nodes = await ApplyMentionsAsync(nodes, criteria.Mentions, cancellationToken);

        var text = criteria.HasText ? criteria.Text!.Trim() : null;
        var keyMatch = text is not null && HumanKeys.TryParseDoc(text, out var docProject, out var docNumber)
            ? projects.Where(p => p.Key == docProject).Select(p => (p.Id, docNumber)).FirstOrDefault()
            : default;
        if (text is not null)
            nodes = ApplyText(nodes, text, keyMatch);
        return new DocSearchScope(nodes, text, keyMatch.Id, keyMatch.docNumber);
    }

    /// <summary>Best match first: an exact key, then a title containing the text, then <c>ts_rank</c> (title weighs more than content).</summary>
    public static IQueryable<Guid> ByRelevance(DocSearchScope scope)
    {
        var text = scope.Text ?? string.Empty;
        var pattern = SqlLike.Contains(text);
        var keyProjectId = scope.KeyProjectId;
        var keyNumber = scope.KeyNumber;
        var ranked = keyNumber > 0
            ? scope.Nodes.Select(n => new
            {
                n.Id,
                n.UpdatedAt,
                Score = (n.ProjectId == keyProjectId && n.Number == keyNumber ? 10f : 0f)
                        + (EF.Functions.ILike(n.Title, pattern) ? 1f : 0f)
                        + EF.Property<NpgsqlTsVector>(n, DocSearch.VectorProperty).Rank(EF.Functions.WebSearchToTsQuery(DocSearch.Configuration, text)),
            })
            : scope.Nodes.Select(n => new
            {
                n.Id,
                n.UpdatedAt,
                Score = (EF.Functions.ILike(n.Title, pattern) ? 1f : 0f)
                        + EF.Property<NpgsqlTsVector>(n, DocSearch.VectorProperty).Rank(EF.Functions.WebSearchToTsQuery(DocSearch.Configuration, text)),
            });
        return ranked.OrderByDescending(r => r.Score).ThenByDescending(r => r.UpdatedAt).ThenByDescending(r => r.Id).Select(r => r.Id);
    }

    /// <summary>The result rows for <paramref name="ids"/> in that order, with paths and a snippet around the match.</summary>
    public async Task<IReadOnlyList<DocSearchItemDto>> ItemsAsync(IReadOnlyList<Guid> ids, string? text, CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
            return [];
        var idList = ids.ToList();
        var query = text ?? string.Empty;
        var hasText = text is not null;
        var rows = await (
                from n in db.DocNodes.AsNoTracking()
                where idList.Contains(n.Id)
                join p in db.Projects on n.ProjectId equals p.Id
                join u in db.Users on n.UpdatedById equals u.Id
                select new
                {
                    n.Id,
                    n.ProjectId,
                    ProjectKey = p.Key,
                    n.Number,
                    n.Kind,
                    n.DiagramFormat,
                    n.Title,
                    n.ParentId,
                    n.CurrentVersion,
                    n.UpdatedAt,
                    UpdatedBy = new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive),
                    Snippet = n.Kind == DocKind.Folder ? null
                        : hasText
                            ? EF.Functions.WebSearchToTsQuery(DocSearch.Configuration, query).GetResultHeadline(
                                DocSearch.Configuration,
                                n.DiagramFormat == DiagramFormat.Canvas ? n.Outline ?? string.Empty : n.Content ?? string.Empty,
                                DocSnippets.HeadlineOptions)
                            : (n.DiagramFormat == DiagramFormat.Canvas ? n.Outline : n.Content)!.Substring(0, DocSnippets.PreviewSourceLength),
                })
            .ToListAsync(cancellationToken);

        var projectIds = rows.Select(r => r.ProjectId).Distinct().ToList();
        var folders = (await db.DocNodes.AsNoTracking()
                .Where(n => projectIds.Contains(n.ProjectId) && n.Kind == DocKind.Folder && n.DeletedAt == null)
                .Select(n => new { n.ProjectId, Folder = new DocFolderIndex.Folder(n.Id, n.ParentId, n.Number, n.Title) })
                .ToListAsync(cancellationToken))
            .GroupBy(f => f.ProjectId)
            .ToDictionary(g => g.Key, g => new DocFolderIndex(g.Select(f => f.Folder)));
        var empty = new DocFolderIndex([]);

        var byId = rows.ToDictionary(r => r.Id);
        return [.. ids.Where(byId.ContainsKey).Select(id =>
        {
            var r = byId[id];
            var index = folders.GetValueOrDefault(r.ProjectId, empty);
            var key = HumanKeys.Doc(r.ProjectKey, r.Number);
            return new DocSearchItemDto(
                r.Id, key, r.ProjectKey, r.Kind, r.DiagramFormat, r.Title, index.PathOf(r.ParentId, r.Title), index.FolderPath(r.ParentId),
                r.CurrentVersion, r.UpdatedBy, r.UpdatedAt, DocQueries.Url(r.ProjectKey, key, r.Title), DocSnippets.Build(r.Snippet));
        })];
    }

    private static IQueryable<DocNode> ApplyText(IQueryable<DocNode> nodes, string text, (Guid Id, int Number) keyMatch)
    {
        var pattern = SqlLike.Contains(text);
        var keyProjectId = keyMatch.Id;
        var keyNumber = keyMatch.Number;
        if (keyNumber > 0)
        {
            return nodes.Where(n =>
                EF.Property<NpgsqlTsVector>(n, DocSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(DocSearch.Configuration, text))
                || EF.Functions.ILike(n.Title, pattern)
                || (n.ProjectId == keyProjectId && n.Number == keyNumber));
        }
        return text.Length >= MinTrigramLength
            ? nodes.Where(n =>
                EF.Property<NpgsqlTsVector>(n, DocSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(DocSearch.Configuration, text))
                || EF.Functions.ILike(n.Title, pattern))
            : nodes.Where(n =>
                EF.Property<NpgsqlTsVector>(n, DocSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(DocSearch.Configuration, text)));
    }

    private async Task<IQueryable<DocNode>> ApplyFolderAsync(
        IQueryable<DocNode> nodes, string? folder, List<Guid> projectIds, CancellationToken cancellationToken)
    {
        if (folder is null)
            return nodes;
        IQueryable<DocNode> candidates;
        if (Guid.TryParse(folder, out var folderId))
        {
            candidates = db.DocNodes.Where(n => n.Id == folderId);
        }
        else
        {
            HumanKeys.TryParseDoc(folder, out var projectKey, out var number);
            candidates = db.DocNodes.Where(n => n.Number == number && db.Projects.Any(p => p.Id == n.ProjectId && p.Key == projectKey));
        }
        var found = await candidates.AsNoTracking()
            .Where(n => n.DeletedAt == null && projectIds.Contains(n.ProjectId))
            .Select(n => new { n.Id, n.ProjectId, n.Kind })
            .FirstOrDefaultAsync(cancellationToken);
        if (found is null)
            return nodes.Where(_ => false);
        if (found.Kind != DocKind.Folder)
            throw AppException.Invalid("folder", $"'{folder}' is not a folder; pass a folder key to search below it.");

        var projectId = found.ProjectId;
        var folders = await db.DocNodes.AsNoTracking()
            .Where(n => n.ProjectId == projectId && n.Kind == DocKind.Folder && n.DeletedAt == null)
            .Select(n => new { n.Id, n.ParentId })
            .ToListAsync(cancellationToken);
        var children = folders.Where(f => f.ParentId is not null).ToLookup(f => f.ParentId!.Value, f => f.Id);
        var subtree = new List<Guid> { found.Id };
        for (var i = 0; i < subtree.Count; i++)
            subtree.AddRange(children[subtree[i]]);
        return nodes.Where(n => n.ProjectId == projectId && n.ParentId != null && subtree.Contains(n.ParentId.Value));
    }

    private async Task<IQueryable<DocNode>> ApplyMentionsAsync(
        IQueryable<DocNode> nodes, string? mentions, CancellationToken cancellationToken)
    {
        if (mentions is null)
            return nodes;
        var tickets = Guid.TryParse(mentions, out var ticketId)
            ? db.Tickets.Where(t => t.Id == ticketId)
            : TicketsByKey(mentions);
        var readableProjects = access.ReadableProjects();
        var resolved = await tickets.AsNoTracking()
            .Where(t => t.DeletedAt == null && readableProjects.Any(p => p.Id == t.ProjectId))
            .Select(t => (Guid?)t.Id)
            .FirstOrDefaultAsync(cancellationToken);
        var id = resolved ?? Guid.Empty;
        return nodes.Where(n => db.DocReferences.Any(r => r.SourceNodeId == n.Id && r.TargetType == DocReferenceTarget.Ticket && r.TargetId == id));
    }

    private IQueryable<Domain.Tickets.Ticket> TicketsByKey(string key)
    {
        HumanKeys.TryParseTicket(key, out var projectKey, out var number);
        return db.Tickets.Where(t => t.Number == number && db.Projects.Any(p => p.Id == t.ProjectId && p.Key == projectKey));
    }
}

/// <summary>A filtered (not yet ordered) docs query and the text it matched, if any.</summary>
internal sealed record DocSearchScope(IQueryable<DocNode> Nodes, string? Text, Guid KeyProjectId, int KeyNumber);
