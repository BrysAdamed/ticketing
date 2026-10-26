using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.TestCases;
using Ticketing.Domain.Common;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Regressions;

/// <param name="RelatedTicket">The test case's ticket; the bug gets a RelatesTo link to it.</param>
public sealed record RegressionBugDraftDto(
    string ProjectKey,
    string Title,
    string Description,
    TicketType Type,
    Severity Severity,
    Priority Priority,
    string? Version,
    IReadOnlyList<string> Labels,
    LinkedTicketDto? RelatedTicket);

/// <summary>
/// The pre-filled bug for a failed item (spec 6.11), built on the server so the web dialog, REST and MCP create identical
/// bugs. Fails when the item is not Failed or already has a bug.
/// </summary>
public static class GetRegressionBugDraft
{
    public sealed record Query(string SessionKeyOrId, string Item);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock)
        : IHandler<Query, RegressionBugDraftDto>
    {
        public async Task<RegressionBugDraftDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await RegressionLookup.WriteAsync(db, access, request.SessionKeyOrId, cancellationToken);
            var itemId = await RegressionLookup.ItemIdAsync(db, target, request.Item, cancellationToken);
            var session = await db.RegressionSessions.AsNoTracking().SingleAsync(s => s.Id == target.Id, cancellationToken);
            var item = await db.RegressionSessionItems.AsNoTracking().SingleAsync(i => i.Id == itemId, cancellationToken);
            return await DraftAsync(db, currentUser, clock, target, session, item, cancellationToken);
        }

        internal static async Task<RegressionBugDraftDto> DraftAsync(
            ITicketingDbContext db, ICurrentUser currentUser, IClock clock, RegressionTarget target, RegressionSession session,
            RegressionSessionItem item, CancellationToken cancellationToken)
        {
            session.EnsureInProgress();
            item.EnsureBugCanBeCreated();

            var executorId = item.ExecutedById ?? currentUser.Id;
            var foundBy = await db.Users.Where(u => u.Id == executorId).Select(u => u.DisplayName).SingleAsync(cancellationToken);
            var draft = RegressionBugTemplate.Draft(session, target.Grant.ProjectKey, item, foundBy, item.ExecutedAt ?? clock.Now);
            var related = await RelatedTicketAsync(db, target.Grant.ProjectKey, item.TestCaseId, cancellationToken);
            return new RegressionBugDraftDto(
                target.Grant.ProjectKey, draft.Title, draft.Description, TicketType.Bug, draft.Severity, draft.Priority, draft.Version, draft.Labels, related);
        }

        private static async Task<LinkedTicketDto?> RelatedTicketAsync(ITicketingDbContext db, string projectKey, Guid testCaseId, CancellationToken cancellationToken)
        {
            var row = await (
                    from c in db.TestCases.AsNoTracking()
                    where c.Id == testCaseId
                    join t in db.Tickets on c.TicketId equals t.Id
                    where t.DeletedAt == null
                    select new { t.Id, t.Number, t.Title, t.Type, t.Status })
                .SingleOrDefaultAsync(cancellationToken);
            return row is null ? null : new LinkedTicketDto(row.Id, HumanKeys.Ticket(projectKey, row.Number), row.Title, row.Type, row.Status);
        }
    }
}
