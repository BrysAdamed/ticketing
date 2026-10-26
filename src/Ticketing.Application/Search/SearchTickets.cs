using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;

namespace Ticketing.Application.Search;

/// <summary>Ticket search over every readable project with structured filters, full text, sort and keyset paging (spec 6.8, I-03).</summary>
public static class SearchTickets
{
    /// <summary>Results are counted up to this many; above it the total reads "10 000+" (also the export limit).</summary>
    public const int CountLimit = ExportTickets.MaxRows;

    public sealed record Query(TicketSearchCriteria Criteria, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, TicketSearchPage>
    {
        public async Task<TicketSearchPage> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var page = request.Page ?? new PageRequest();
            var criteria = request.Criteria;
            var order = criteria.EffectiveOrder;
            var rows = await new TicketSearchQuery(db, access, currentUser).BuildAsync(criteria, cancellationToken);

            int? total = null;
            if (page.Cursor is null)
                total = await rows.Take(CountLimit + 1).CountAsync(cancellationToken);

            var paged = await TicketSearchOrdering
                .OrderBy(TicketSearchOrdering.After(rows, criteria.Sort, order, page.Cursor), criteria.Sort, order)
                .ToCursorPageAsync(page, r => TicketSearchOrdering.CursorFor(r, criteria.Sort, order), cancellationToken);

            var summaries = await TicketQueries.SummariesAsync(db, [.. paged.Items.Select(r => r.Id)], cancellationToken);
            return new TicketSearchPage(
                summaries, paged.NextCursor, total is null ? null : Math.Min(total.Value, CountLimit), total > CountLimit);
        }
    }
}

/// <summary>A page of search results. <c>total</c> is only computed for the first page and is capped (<c>totalCapped</c>).</summary>
public sealed record TicketSearchPage(IReadOnlyList<TicketSummaryDto> Items, string? NextCursor, int? Total, bool TotalCapped);
