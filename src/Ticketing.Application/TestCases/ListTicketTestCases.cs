using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;

namespace Ticketing.Application.TestCases;

/// <summary>The non-archived test cases written for one ticket (spec 6.10, the ticket view's test case section), by number.</summary>
public static class ListTicketTestCases
{
    public sealed record Query(string TicketKeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, IReadOnlyList<TestCaseSummaryDto>>
    {
        public async Task<IReadOnlyList<TestCaseSummaryDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var ticket = await TicketLookup.ReadAsync(db, access, request.TicketKeyOrId, cancellationToken);
            var ticketId = ticket.Id;
            var rows = await TestCaseQueries.Summaries(
                    db,
                    db.TestCases.AsNoTracking().Where(c => c.TicketId == ticketId && c.ArchivedAt == null).OrderBy(c => c.Number))
                .ToListAsync(cancellationToken);
            return [.. rows.Select(r => r.ToDto(ticket.Grant.ProjectKey))];
        }
    }
}
