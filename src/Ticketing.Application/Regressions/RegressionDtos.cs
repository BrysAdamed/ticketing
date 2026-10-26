using Ticketing.Application.TestCases;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Regressions;

/// <summary>Session summary (spec 6.11): pass rate = passed / (passed + failed), null while nothing has passed or failed.</summary>
public sealed record RegressionSummaryDto(
    int Total,
    int Passed,
    int PassedManual,
    int PassedAutomatic,
    int Failed,
    int Skipped,
    int Waiting,
    double? PassRate,
    int BugsCreated)
{
    public static RegressionSummaryDto From(RegressionSummary summary) => new(
        summary.Total, summary.Passed, summary.PassedManual, summary.PassedAutomatic, summary.Failed, summary.Skipped, summary.Waiting,
        summary.PassRate, summary.BugsCreated);
}

public sealed record RegressionSessionSummaryDto(
    Guid Id,
    string Key,
    int Number,
    string Name,
    string? Version,
    RegressionSessionStatus Status,
    DateTimeOffset StartedAt,
    UserRefDto StartedBy,
    DateTimeOffset? CompletedAt,
    DateTimeOffset? CancelledAt,
    RegressionSummaryDto Summary,
    string Url);

/// <summary>The bug created from an item. A deleted bug stays referenced and is shown as deleted (spec 6.2).</summary>
public sealed record RegressionBugRefDto(Guid Id, string Key, string Title, TicketStatus Status, bool Deleted, string Url);

public sealed record RegressionItemDto(
    Guid Id,
    Guid TestCaseId,
    string TestCaseKey,
    int Order,
    string Title,
    string? Preconditions,
    IReadOnlyList<string> Steps,
    string? ExpectedResult,
    string? AutomationReference,
    ExecutionMode ExecutionMode,
    RegressionItemStatus Status,
    bool AutoPassed,
    UserRefDto? Assignee,
    string? ResultNote,
    DateTimeOffset? ExecutedAt,
    UserRefDto? ExecutedBy,
    RegressionBugRefDto? Bug,
    string Url,
    uint RowVersion);

public sealed record RegressionPermissionsDto(bool CanExecute, bool CanAssign, bool CanComplete, bool CanCancel);

public sealed record RegressionSessionDto(
    Guid Id,
    string Key,
    Guid ProjectId,
    string ProjectKey,
    int Number,
    string Name,
    string? Version,
    RegressionSessionStatus Status,
    DateTimeOffset StartedAt,
    UserRefDto StartedBy,
    DateTimeOffset? CompletedAt,
    UserRefDto? CompletedBy,
    DateTimeOffset? CancelledAt,
    UserRefDto? CancelledBy,
    RegressionSummaryDto Summary,
    IReadOnlyList<RegressionItemDto> Items,
    RegressionPermissionsDto Permissions,
    string Url,
    uint RowVersion);

/// <summary>The result of an item change: the item and the refreshed session summary, so clients can update progress without a refetch.</summary>
public sealed record RegressionItemChangeDto(RegressionItemDto Item, RegressionSummaryDto Summary);
