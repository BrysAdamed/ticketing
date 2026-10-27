using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Search;

/// <summary>
/// "My work" (spec 6.8, I-08): open tickets assigned to the caller across readable projects, grouped by project, plus
/// the caller's waiting items in running regression sessions. Bounded; the full list is the search
/// <c>assignee=me&amp;category=ToDo,InProgress</c>.
/// </summary>
public static class GetMyWork
{
    public const int MaxTickets = 500;
    public const int MaxRegressionItems = 200;

    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, MyWorkDto>
    {
        public async Task<MyWorkDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var me = currentUser.Id;
            var readable = access.ReadableProjects().AsNoTracking();

            var ticketRows = await (
                    from t in db.Tickets.AsNoTracking()
                    join p in readable on t.ProjectId equals p.Id
                    where t.AssigneeId == me && t.DeletedAt == null && t.Status != TicketStatus.Done
                    orderby p.Key, t.Priority, t.UpdatedAt descending
                    select new { t.Id, p.Key, p.Name })
                .Take(MaxTickets + 1)
                .ToListAsync(cancellationToken);
            var truncated = ticketRows.Count > MaxTickets;
            if (truncated)
                ticketRows.RemoveAt(ticketRows.Count - 1);

            var summaries = (await TicketQueries.SummariesAsync(db, [.. ticketRows.Select(r => r.Id)], cancellationToken)).ToDictionary(s => s.Id);
            var groups = ticketRows
                .GroupBy(r => (r.Key, r.Name))
                .Select(g => new MyWorkProjectDto(g.Key.Key, g.Key.Name, [.. g.Select(r => summaries[r.Id])]))
                .ToList();

            var items = await (
                    from i in db.RegressionSessionItems.AsNoTracking()
                    join s in db.RegressionSessions on i.SessionId equals s.Id
                    join p in readable on s.ProjectId equals p.Id
                    where i.AssigneeId == me && i.Status == RegressionItemStatus.WaitingForExecution && s.Status == RegressionSessionStatus.InProgress
                    orderby s.StartedAt, i.Order
                    select new { ItemId = i.Id, i.TestCaseKey, i.Title, i.ExecutionMode, SessionId = s.Id, s.Number, s.Name, s.Version, ProjectKey = p.Key })
                .Take(MaxRegressionItems)
                .ToListAsync(cancellationToken);

            return new MyWorkDto(
                groups,
                ticketRows.Count,
                truncated,
                [.. items.Select(i =>
                {
                    var sessionKey = HumanKeys.Regression(i.ProjectKey, i.Number);
                    return new MyRegressionItemDto(
                        i.ItemId, i.TestCaseKey, i.Title, i.ExecutionMode, i.SessionId, sessionKey, i.Name, i.Version, i.ProjectKey,
                        SearchUrls.RegressionItem(i.ProjectKey, sessionKey, i.TestCaseKey));
                })]);
        }
    }
}

/// <param name="TicketCount">Tickets returned (at most 500).</param>
/// <param name="Truncated">More open tickets are assigned than returned; link to the search instead.</param>
public sealed record MyWorkDto(IReadOnlyList<MyWorkProjectDto> Projects, int TicketCount, bool Truncated, IReadOnlyList<MyRegressionItemDto> RegressionItems);

public sealed record MyWorkProjectDto(string ProjectKey, string ProjectName, IReadOnlyList<TicketSummaryDto> Tickets);

public sealed record MyRegressionItemDto(
    Guid ItemId,
    string TestCaseKey,
    string Title,
    ExecutionMode ExecutionMode,
    Guid SessionId,
    string SessionKey,
    string SessionName,
    string? SessionVersion,
    string ProjectKey,
    string Url);
