using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.TestCases;

// TODO: replace with Ticketing.Application.Tickets.UserRefDto (same shape) once feat/tickets is on main.
public sealed record UserRefDto(Guid Id, string Email, string DisplayName, bool IsActive);

/// <summary>The ticket a test case was written for (same project, never deleted: deleting the ticket unlinks it).</summary>
public sealed record LinkedTicketDto(Guid Id, string Key, string Title, TicketType Type, TicketStatus Status);

/// <summary>The latest recorded result of a test case in a non-cancelled regression session.</summary>
public sealed record TestCaseRunDto(
    Guid SessionId,
    string SessionKey,
    string SessionName,
    string? Version,
    RegressionSessionStatus SessionStatus,
    RegressionItemStatus Status,
    bool AutoPassed,
    DateTimeOffset? ExecutedAt,
    UserRefDto? ExecutedBy,
    string? BugKey);

public sealed record TestCaseSummaryDto(
    Guid Id,
    string Key,
    int Number,
    string Title,
    TestCaseStatus Status,
    int StepCount,
    LinkedTicketDto? Ticket,
    bool Archived,
    DateTimeOffset UpdatedAt,
    TestCaseLastRunDto? LastRun);

public sealed record TestCaseLastRunDto(string SessionKey, RegressionItemStatus Status, DateTimeOffset? ExecutedAt);

public sealed record TestCaseCountsDto(int New, int Manual, int Automatic, int Archived)
{
    /// <summary>Non-archived test cases.</summary>
    public int Active => New + Manual + Automatic;
}

/// <summary>A page of test cases plus counts by status for the same text and ticket filters (status filter ignored).</summary>
public sealed record TestCaseListDto(IReadOnlyList<TestCaseSummaryDto> Items, string? NextCursor, TestCaseCountsDto Counts);

public sealed record TestCasePermissionsDto(bool CanEdit, bool CanDelete);

public sealed record TestCaseDto(
    Guid Id,
    string Key,
    Guid ProjectId,
    string ProjectKey,
    int Number,
    string Title,
    string? Preconditions,
    IReadOnlyList<string> Steps,
    string? ExpectedResult,
    TestCaseStatus Status,
    string? AutomationReference,
    LinkedTicketDto? Ticket,
    DateTimeOffset? ArchivedAt,
    UserRefDto? ArchivedBy,
    DateTimeOffset CreatedAt,
    UserRefDto CreatedBy,
    DateTimeOffset UpdatedAt,
    int SessionCount,
    IReadOnlyList<TestCaseRunDto> RecentRuns,
    TestCasePermissionsDto Permissions,
    string Url,
    uint RowVersion);
