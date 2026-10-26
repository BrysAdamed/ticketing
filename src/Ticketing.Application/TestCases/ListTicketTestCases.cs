using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.TestCases;

/// <summary>The non-archived test cases written for one ticket (spec 6.10, the ticket view's test case section), by number.</summary>
public static class ListTicketTestCases
{
    public sealed record Query(string TicketKeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, IReadOnlyList<TestCaseSummaryDto>>
    {
        public async Task<IReadOnlyList<TestCaseSummaryDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            // TODO: resolve with TicketLookup.ReadAsync once feat/tickets is on main (adds the ticket.deleted message).
            var ticket = await FindTicketAsync(request.TicketKeyOrId, cancellationToken);
            var grant = await access.FindAsync(ticket.ProjectId, cancellationToken) ?? throw NotFound(request.TicketKeyOrId);
            var ticketId = ticket.Id;

            var rows = await TestCaseQueries.Summaries(
                    db,
                    db.TestCases.AsNoTracking().Where(c => c.TicketId == ticketId && c.ArchivedAt == null).OrderBy(c => c.Number))
                .ToListAsync(cancellationToken);
            return [.. rows.Select(r => r.ToDto(grant.ProjectKey))];
        }

        private async Task<(Guid Id, Guid ProjectId)> FindTicketAsync(string keyOrId, CancellationToken cancellationToken)
        {
            IQueryable<Ticket> tickets;
            if (Guid.TryParse(keyOrId, out var id))
                tickets = db.Tickets.Where(t => t.Id == id);
            else if (HumanKeys.TryParseTicket(keyOrId, out var projectKey, out var number))
                tickets = db.Tickets.Where(t => t.Number == number && db.Projects.Any(p => p.Id == t.ProjectId && p.Key == projectKey));
            else
                throw NotFound(keyOrId);

            var row = await tickets.AsNoTracking().Where(t => t.DeletedAt == null).Select(t => new { t.Id, t.ProjectId }).SingleOrDefaultAsync(cancellationToken)
                ?? throw NotFound(keyOrId);
            return (row.Id, row.ProjectId);
        }

        private static AppException NotFound(string keyOrId) =>
            AppException.NotFound(TicketErrors.NotFound, $"Ticket '{keyOrId.Trim()}' was not found.");
    }
}
