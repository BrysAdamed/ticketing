using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.TestCases;
using Ticketing.Domain.Common;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Regressions;

/// <summary>Read models of regression sessions. Summaries are one aggregate query over the items, never a load of the items.</summary>
public static class RegressionQueries
{
    public static async Task<IReadOnlyDictionary<Guid, RegressionSummaryDto>> SummariesAsync(
        ITicketingDbContext db, IReadOnlyCollection<Guid> sessionIds, CancellationToken cancellationToken)
    {
        var rows = await db.RegressionSessionItems.AsNoTracking()
            .Where(i => sessionIds.Contains(i.SessionId))
            .GroupBy(i => i.SessionId)
            .Select(g => new
            {
                SessionId = g.Key,
                Total = g.Count(),
                PassedManual = g.Count(i => i.Status == RegressionItemStatus.Passed && i.ExecutionMode == ExecutionMode.Manual),
                PassedAutomatic = g.Count(i => i.Status == RegressionItemStatus.Passed && i.ExecutionMode == ExecutionMode.Automatic),
                Failed = g.Count(i => i.Status == RegressionItemStatus.Failed),
                Skipped = g.Count(i => i.Status == RegressionItemStatus.Skipped),
                Waiting = g.Count(i => i.Status == RegressionItemStatus.WaitingForExecution),
                Bugs = g.Count(i => i.BugTicketId != null),
            })
            .ToListAsync(cancellationToken);

        var empty = RegressionSummaryDto.From(new RegressionSummary(0, 0, 0, 0, 0, 0, 0));
        var byId = rows.ToDictionary(
            r => r.SessionId,
            r => RegressionSummaryDto.From(new RegressionSummary(r.Total, r.PassedManual, r.PassedAutomatic, r.Failed, r.Skipped, r.Waiting, r.Bugs)));
        return sessionIds.ToDictionary(id => id, id => byId.GetValueOrDefault(id, empty));
    }

    public static async Task<RegressionSummaryDto> SummaryAsync(ITicketingDbContext db, Guid sessionId, CancellationToken cancellationToken) =>
        (await SummariesAsync(db, [sessionId], cancellationToken))[sessionId];

    /// <summary>List rows for already filtered and ordered sessions.</summary>
    internal static IQueryable<SessionRow> SessionRows(ITicketingDbContext db, IQueryable<RegressionSession> sessions) =>
        sessions.Select(s => new SessionRow(
            s.Id,
            s.Number,
            s.Name,
            s.Version,
            s.Status,
            s.StartedAt,
            db.Users.Where(u => u.Id == s.StartedById).Select(u => new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive)).First(),
            s.CompletedAt,
            s.CancelledAt));

    public static async Task<RegressionSessionSummaryDto> SessionSummaryAsync(ITicketingDbContext db, RegressionTarget target, CancellationToken cancellationToken)
    {
        var id = target.Id;
        var row = await SessionRows(db, db.RegressionSessions.AsNoTracking().Where(s => s.Id == id)).SingleAsync(cancellationToken);
        return row.ToDto(target.Grant.ProjectKey, await SummaryAsync(db, id, cancellationToken));
    }

    internal static RegressionSessionSummaryDto ToDto(this SessionRow row, string projectKey, RegressionSummaryDto summary)
    {
        var key = HumanKeys.Regression(projectKey, row.Number);
        return new RegressionSessionSummaryDto(
            row.Id, key, row.Number, row.Name, row.Version, row.Status, row.StartedAt, row.StartedBy, row.CompletedAt, row.CancelledAt, summary,
            RegressionLookup.Url(projectKey, key));
    }

    public static async Task<RegressionSessionDto> LoadAsync(
        ITicketingDbContext db, ICurrentUser currentUser, RegressionTarget target, ItemFilter filter, CancellationToken cancellationToken)
    {
        var id = target.Id;
        var row = await (
                from s in db.RegressionSessions.AsNoTracking()
                where s.Id == id
                join starter in db.Users on s.StartedById equals starter.Id
                from completer in db.Users.Where(u => u.Id == s.CompletedById).DefaultIfEmpty()
                from canceller in db.Users.Where(u => u.Id == s.CancelledById).DefaultIfEmpty()
                select new
                {
                    s.Id, s.ProjectId, s.Number, s.Name, s.Version, s.Status, s.StartedAt, s.CompletedAt, s.CancelledAt, s.RowVersion,
                    StartedBy = new UserRefDto(starter.Id, starter.Email, starter.DisplayName, starter.IsActive),
                    CompletedBy = completer == null ? null : new UserRefDto(completer.Id, completer.Email, completer.DisplayName, completer.IsActive),
                    CancelledBy = canceller == null ? null : new UserRefDto(canceller.Id, canceller.Email, canceller.DisplayName, canceller.IsActive),
                })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw RegressionLookup.NotFound(target.Key);

        var projectKey = target.Grant.ProjectKey;
        var key = HumanKeys.Regression(projectKey, row.Number);
        var inProgress = row.Status == RegressionSessionStatus.InProgress;
        var canWrite = target.Grant.CanWrite && !target.Grant.IsArchived && currentUser.PatScope != PatScope.ReadOnly;
        var permissions = new RegressionPermissionsDto(
            CanExecute: inProgress && canWrite,
            CanAssign: inProgress && canWrite && target.Grant.IsOwner,
            CanComplete: inProgress && canWrite,
            CanCancel: inProgress && canWrite && (target.Grant.IsOwner || row.StartedBy.Id == currentUser.Id));

        return new RegressionSessionDto(
            row.Id, key, row.ProjectId, projectKey, row.Number, row.Name, row.Version, row.Status, row.StartedAt, row.StartedBy, row.CompletedAt,
            row.CompletedBy, row.CancelledAt, row.CancelledBy, await SummaryAsync(db, id, cancellationToken),
            await ItemsAsync(db, target, filter, cancellationToken), permissions, RegressionLookup.Url(projectKey, key), row.RowVersion);
    }

    public static async Task<IReadOnlyList<RegressionItemDto>> ItemsAsync(
        ITicketingDbContext db, RegressionTarget session, ItemFilter filter, CancellationToken cancellationToken)
    {
        var sessionId = session.Id;
        var items = db.RegressionSessionItems.AsNoTracking().Where(i => i.SessionId == sessionId);
        if (filter.ItemId is { } itemId)
            items = items.Where(i => i.Id == itemId);
        if (filter.Statuses is { Count: > 0 } statuses)
            items = items.Where(i => statuses.Contains(i.Status));
        if (filter.FilterByAssignee)
            items = filter.AssigneeId is { } assigneeId ? items.Where(i => i.AssigneeId == assigneeId) : items.Where(i => i.AssigneeId == null);

        var rows = await (
                from i in items
                from a in db.Users.Where(u => u.Id == i.AssigneeId).DefaultIfEmpty()
                from e in db.Users.Where(u => u.Id == i.ExecutedById).DefaultIfEmpty()
                from b in db.Tickets.Where(t => t.Id == i.BugTicketId).DefaultIfEmpty()
                orderby i.Order
                select new
                {
                    Item = i,
                    Assignee = a == null ? null : new UserRefDto(a.Id, a.Email, a.DisplayName, a.IsActive),
                    ExecutedBy = e == null ? null : new UserRefDto(e.Id, e.Email, e.DisplayName, e.IsActive),
                    BugNumber = (int?)b.Number,
                    BugTitle = b.Title,
                    BugStatus = (TicketStatus?)b.Status,
                    BugDeleted = b.DeletedAt != null,
                })
            .ToListAsync(cancellationToken);

        var projectKey = session.Grant.ProjectKey;
        var sessionKey = session.Key;
        return [.. rows.Select(r =>
        {
            var item = r.Item;
            var bug = item.BugTicketId is { } bugId && r.BugNumber is { } bugNumber
                ? new RegressionBugRefDto(bugId, HumanKeys.Ticket(projectKey, bugNumber), r.BugTitle!, r.BugStatus!.Value, r.BugDeleted, $"/tickets/{HumanKeys.Ticket(projectKey, bugNumber)}")
                : null;
            return new RegressionItemDto(
                item.Id, item.TestCaseId, item.TestCaseKey, item.Order, item.Title, item.Preconditions, item.Steps, item.ExpectedResult,
                item.AutomationReference, item.ExecutionMode, item.Status, item.IsAutoPassed, r.Assignee, item.ResultNote, item.ExecutedAt,
                r.ExecutedBy, bug, RegressionLookup.ItemUrl(projectKey, sessionKey, item.TestCaseKey), item.RowVersion);
        })];
    }

    public static async Task<RegressionItemChangeDto> ItemChangeAsync(
        ITicketingDbContext db, RegressionTarget session, Guid itemId, CancellationToken cancellationToken) =>
        new((await ItemsAsync(db, session, ItemFilter.Single(itemId), cancellationToken))[0], await SummaryAsync(db, session.Id, cancellationToken));

    internal sealed record SessionRow(
        Guid Id, int Number, string Name, string? Version, RegressionSessionStatus Status, DateTimeOffset StartedAt, UserRefDto StartedBy,
        DateTimeOffset? CompletedAt, DateTimeOffset? CancelledAt);

    /// <param name="FilterByAssignee">When true, only items assigned to <paramref name="AssigneeId"/> (null = unassigned).</param>
    public sealed record ItemFilter(IReadOnlyList<RegressionItemStatus>? Statuses = null, bool FilterByAssignee = false, Guid? AssigneeId = null, Guid? ItemId = null)
    {
        public static readonly ItemFilter All = new();

        public static ItemFilter Single(Guid itemId) => new(ItemId: itemId);
    }
}
