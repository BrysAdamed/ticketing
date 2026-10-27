using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Docs search over every readable project (refinement 1.10): title, latest published content and Canvas labels; deleted
/// docs and drafts are never matched. With text the default sort is relevance (at most 100, no cursor); otherwise, or with
/// <c>sort=updated</c>, newest first with a keyset cursor.
/// </summary>
public static class SearchDocs
{
    /// <summary>Results are counted up to this many; above it the UI shows "1 000+".</summary>
    public const int CountLimit = 1000;

    public sealed record Query(DocSearchCriteria Criteria, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, DocSearchPage>
    {
        public async Task<DocSearchPage> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var page = request.Page ?? new PageRequest();
            var criteria = request.Criteria;
            var sort = criteria.EffectiveSort;
            if (sort == DocSearchSort.Relevance && page.Cursor is not null)
                throw AppException.Invalid("cursor", "Relevance results are not paged; refine the text or use sort=updated to page.");

            var search = new DocSearchQuery(db, access);
            var scope = await search.BuildAsync(criteria, cancellationToken);
            int? total = null;
            if (page.Cursor is null)
                total = await scope.Nodes.Take(CountLimit + 1).CountAsync(cancellationToken);

            IReadOnlyList<Guid> ids;
            string? nextCursor = null;
            if (sort == DocSearchSort.Relevance)
            {
                ids = await DocSearchQuery.ByRelevance(scope).Take(page.Size).ToListAsync(cancellationToken);
            }
            else
            {
                var paged = await After(scope.Nodes, page.Cursor)
                    .OrderByDescending(n => n.UpdatedAt).ThenByDescending(n => n.Id)
                    .Select(n => new UpdatedCursor(n.UpdatedAt, n.Id))
                    .ToCursorPageAsync(page, r => r, cancellationToken);
                ids = [.. paged.Items.Select(r => r.I)];
                nextCursor = paged.NextCursor;
            }

            var items = await search.ItemsAsync(ids, scope.Text, cancellationToken);
            return new DocSearchPage(items, nextCursor, total is null ? null : Math.Min(total.Value, CountLimit), total > CountLimit, sort);
        }

        private static IQueryable<DocNode> After(IQueryable<DocNode> nodes, string? cursor)
        {
            var position = Cursor.Decode<UpdatedCursor>(cursor);
            if (position is null)
                return nodes;
            var at = position.T;
            var id = position.I;
            return nodes.Where(n => n.UpdatedAt < at || (n.UpdatedAt == at && n.Id.CompareTo(id) < 0));
        }
    }

    /// <summary>The keyset of the updated sort, serialized into the opaque cursor.</summary>
    internal sealed record UpdatedCursor(DateTimeOffset T, Guid I);
}

/// <summary>One docs search result. <see cref="Snippet"/> is plain text with highlight ranges (null for folders and empty docs).</summary>
public sealed record DocSearchItemDto(
    Guid Id,
    string Key,
    string ProjectKey,
    DocKind Kind,
    DiagramFormat? DiagramFormat,
    string Title,
    string Path,
    string FolderPath,
    int Version,
    UserRefDto UpdatedBy,
    DateTimeOffset UpdatedAt,
    string Url,
    DocSnippetDto? Snippet);

/// <summary>A page of docs search results. <c>total</c> is counted on the first page only, capped (<c>totalCapped</c>); <c>sort</c> is the sort applied.</summary>
public sealed record DocSearchPage(IReadOnlyList<DocSearchItemDto> Items, string? NextCursor, int? Total, bool TotalCapped, DocSearchSort Sort);
