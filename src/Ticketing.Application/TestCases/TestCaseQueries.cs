using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.TestCases;

/// <summary>Read models of test cases: the full view (with recent runs) and the list rows, each one query without N+1.</summary>
public static class TestCaseQueries
{
    public const int RecentRunCount = 10;

    public static async Task<TestCaseDto> LoadAsync(
        ITicketingDbContext db, ICurrentUser currentUser, TestCaseTarget target, CancellationToken cancellationToken)
    {
        var id = target.Id;
        var row = await (
                from c in db.TestCases.AsNoTracking()
                where c.Id == id
                join creator in db.Users on c.CreatedById equals creator.Id
                from archiver in db.Users.Where(u => u.Id == c.ArchivedById).DefaultIfEmpty()
                from ticket in db.Tickets.Where(t => t.Id == c.TicketId && t.DeletedAt == null).DefaultIfEmpty()
                select new
                {
                    Case = c,
                    CreatedBy = new UserRefDto(creator.Id, creator.Email, creator.DisplayName, creator.IsActive),
                    ArchivedById = (Guid?)archiver.Id,
                    ArchivedByEmail = archiver.Email,
                    ArchivedByName = archiver.DisplayName,
                    ArchivedByActive = (bool?)archiver.IsActive,
                    TicketId = (Guid?)ticket.Id,
                    TicketNumber = (int?)ticket.Number,
                    TicketTitle = ticket.Title,
                    TicketType = (TicketType?)ticket.Type,
                    TicketStatus = (TicketStatus?)ticket.Status,
                    SessionCount = db.RegressionSessionItems.Count(i => i.TestCaseId == c.Id),
                })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw TestCaseLookup.NotFound(target.Key);

        var projectKey = target.Grant.ProjectKey;
        var testCase = row.Case;
        var linked = row.TicketId is { } ticketId
            ? new LinkedTicketDto(ticketId, HumanKeys.Ticket(projectKey, row.TicketNumber!.Value), row.TicketTitle!, row.TicketType!.Value, row.TicketStatus!.Value)
            : null;
        var archivedBy = row.ArchivedById is { } archivedById
            ? new UserRefDto(archivedById, row.ArchivedByEmail!, row.ArchivedByName!, row.ArchivedByActive!.Value)
            : null;
        var canEdit = target.Grant.CanWrite && !target.Grant.IsArchived && currentUser.PatScope != PatScope.ReadOnly;
        var key = HumanKeys.TestCase(projectKey, testCase.Number);

        return new TestCaseDto(
            testCase.Id, key, testCase.ProjectId, projectKey, testCase.Number, testCase.Title, testCase.Preconditions, testCase.Steps,
            testCase.ExpectedResult, testCase.Status, testCase.AutomationReference, linked, testCase.ArchivedAt, archivedBy, testCase.CreatedAt,
            row.CreatedBy, testCase.UpdatedAt, row.SessionCount, await RecentRunsAsync(db, projectKey, id, cancellationToken),
            new TestCasePermissionsDto(canEdit, canEdit && target.Grant.IsOwner && row.SessionCount == 0),
            TestCaseLookup.Url(projectKey, key), testCase.RowVersion);
    }

    /// <summary>List rows for already filtered and ordered test cases of one project.</summary>
    internal static IQueryable<SummaryRow> Summaries(ITicketingDbContext db, IQueryable<TestCase> cases) =>
        cases.Select(c => new SummaryRow(
            c.Id,
            c.Number,
            c.Title,
            c.Status,
            c.Steps.Count,
            c.ArchivedAt != null,
            c.UpdatedAt,
            db.Tickets
                .Where(t => t.Id == c.TicketId && t.DeletedAt == null)
                .Select(t => new TicketRow(t.Id, t.Number, t.Title, t.Type, t.Status))
                .FirstOrDefault(),
            db.RegressionSessionItems
                .Where(i => i.TestCaseId == c.Id && i.Status != RegressionItemStatus.WaitingForExecution)
                .Join(db.RegressionSessions.Where(s => s.Status != RegressionSessionStatus.Cancelled), i => i.SessionId, s => s.Id,
                    (i, s) => new { s.Number, i.Status, i.ExecutedAt })
                .OrderByDescending(r => r.Number)
                .Select(r => new LastRunRow(r.Number, r.Status, r.ExecutedAt))
                .FirstOrDefault()));

    internal static TestCaseSummaryDto ToDto(this SummaryRow row, string projectKey) => new(
        row.Id,
        HumanKeys.TestCase(projectKey, row.Number),
        row.Number,
        row.Title,
        row.Status,
        row.StepCount,
        row.Ticket is { } t ? new LinkedTicketDto(t.Id, HumanKeys.Ticket(projectKey, t.Number), t.Title, t.Type, t.Status) : null,
        row.Archived,
        row.UpdatedAt,
        row.LastRun is { } r ? new TestCaseLastRunDto(HumanKeys.Regression(projectKey, r.SessionNumber), r.Status, r.ExecutedAt) : null);

    /// <summary>
    /// Resolves the ticket a test case is written for: a key or id of a non-deleted ticket in the same project; null or
    /// blank clears the link.
    /// </summary>
    internal static async Task<Guid?> LinkedTicketAsync(
        ITicketingDbContext db, ProjectAccessGrant grant, string? keyOrId, CancellationToken cancellationToken)
    {
        var reference = keyOrId?.Trim();
        if (string.IsNullOrEmpty(reference))
            return null;

        var projectId = grant.ProjectId;
        IQueryable<Ticket> tickets;
        if (Guid.TryParse(reference, out var id))
            tickets = db.Tickets.Where(t => t.Id == id);
        else if (HumanKeys.TryParseTicket(reference, out var projectKey, out var number) && projectKey == grant.ProjectKey)
            tickets = db.Tickets.Where(t => t.Number == number);
        else
            throw TicketInvalid(reference, grant.ProjectKey);

        return await tickets
                .Where(t => t.ProjectId == projectId && t.DeletedAt == null)
                .Select(t => (Guid?)t.Id)
                .SingleOrDefaultAsync(cancellationToken)
            ?? throw TicketInvalid(reference, grant.ProjectKey);
    }

    private static async Task<IReadOnlyList<TestCaseRunDto>> RecentRunsAsync(
        ITicketingDbContext db, string projectKey, Guid testCaseId, CancellationToken cancellationToken)
    {
        var rows = await (
                from i in db.RegressionSessionItems.AsNoTracking()
                where i.TestCaseId == testCaseId
                join s in db.RegressionSessions on i.SessionId equals s.Id
                where s.Status != RegressionSessionStatus.Cancelled
                from u in db.Users.Where(u => u.Id == i.ExecutedById).DefaultIfEmpty()
                from b in db.Tickets.Where(t => t.Id == i.BugTicketId).DefaultIfEmpty()
                orderby s.Number descending
                select new
                {
                    SessionId = s.Id, s.Number, s.Name, s.Version, SessionStatus = s.Status, i.Status, i.ExecutionMode, i.ExecutedAt,
                    ExecutedById = (Guid?)u.Id, ExecutedByEmail = u.Email, ExecutedByName = u.DisplayName, ExecutedByActive = (bool?)u.IsActive,
                    BugNumber = (int?)b.Number,
                })
            .Take(RecentRunCount)
            .ToListAsync(cancellationToken);

        return [.. rows.Select(r => new TestCaseRunDto(
            r.SessionId,
            HumanKeys.Regression(projectKey, r.Number),
            r.Name,
            r.Version,
            r.SessionStatus,
            r.Status,
            r.ExecutionMode == ExecutionMode.Automatic && r.Status == RegressionItemStatus.Passed && r.ExecutedById is null,
            r.ExecutedAt,
            r.ExecutedById is { } executorId ? new UserRefDto(executorId, r.ExecutedByEmail!, r.ExecutedByName!, r.ExecutedByActive!.Value) : null,
            r.BugNumber is { } bug ? HumanKeys.Ticket(projectKey, bug) : null))];
    }

    private static AppException TicketInvalid(string reference, string projectKey)
    {
        var message = $"Ticket '{reference}' was not found in project {projectKey}.";
        return new AppException(
            ErrorKind.Validation, TestCaseErrors.TicketInvalid, message, "Link a ticket of the same project, or clear the link.",
            new Dictionary<string, string[]> { ["ticketKey"] = [message] });
    }

    internal sealed record SummaryRow(
        Guid Id, int Number, string Title, TestCaseStatus Status, int StepCount, bool Archived, DateTimeOffset UpdatedAt, TicketRow? Ticket, LastRunRow? LastRun);

    internal sealed record TicketRow(Guid Id, int Number, string Title, TicketType Type, TicketStatus Status);

    internal sealed record LastRunRow(int SessionNumber, RegressionItemStatus Status, DateTimeOffset? ExecutedAt);
}
