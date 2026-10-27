using Ticketing.Application.Docs;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Dashboard;

/// <summary>
/// All widgets of the project dashboard (spec 7). Ticket widgets honour <see cref="Version"/>; test case, regression and
/// docs widgets do not.
/// </summary>
public sealed record ProjectDashboardDto(
    string ProjectKey,
    string? Version,
    DateTimeOffset GeneratedAt,
    DashboardTotalsDto Totals,
    IReadOnlyList<StatusCountDto> ByStatus,
    IReadOnlyList<TypeCountDto> ByType,
    IReadOnlyList<PriorityCountDto> ByPriority,
    IReadOnlyList<SeverityCountDto> OpenBugsBySeverity,
    IReadOnlyList<WeekCountDto> CreatedVsResolved,
    OpenByAssigneeDto OpenByAssignee,
    StaleTicketsDto Stale,
    EpicProgressDto EpicProgress,
    TestCaseStatsDto TestCases,
    RegressionStatsDto Regressions,
    RegressionBugsDto RegressionBugs,
    RecentDocsDto RecentDocs);

public sealed record DashboardTotalsDto(int OpenTickets, int DoneTickets, int OpenStoryPoints, int UnassignedOpenTickets);

public sealed record StatusCountDto(TicketStatus Status, StatusCategory Category, int Count);

public sealed record TypeCountDto(TicketType Type, int Count);

public sealed record PriorityCountDto(Priority Priority, int Count);

/// <param name="Severity">Null is the "none" bucket: open bugs without a severity.</param>
public sealed record SeverityCountDto(Severity? Severity, int Count);

/// <param name="WeekStart">Monday of the ISO week (UTC).</param>
/// <param name="IsoWeek">For example <c>2026-W43</c>.</param>
/// <param name="Resolved">Tickets whose <c>ResolvedAt</c> falls in the week (they entered Done and are still Done).</param>
public sealed record WeekCountDto(DateOnly WeekStart, string IsoWeek, int Created, int Resolved);

public sealed record DashboardUserDto(Guid Id, string Email, string DisplayName, bool IsActive);

public sealed record AssigneeCountDto(DashboardUserDto User, int Count);

/// <param name="Top">At most 10 assignees by open count, highest first.</param>
/// <param name="Others">Open tickets assigned to anyone outside <paramref name="Top"/>.</param>
public sealed record OpenByAssigneeDto(IReadOnlyList<AssigneeCountDto> Top, int Unassigned, int Others);

public sealed record DashboardTicketDto(
    string Key,
    string Title,
    TicketType Type,
    TicketStatus Status,
    Priority Priority,
    Severity? Severity,
    DashboardUserDto? Assignee,
    DateTimeOffset UpdatedAt);

/// <param name="UpdatedBefore">Open tickets not updated since this instant are stale.</param>
/// <param name="Oldest">The 10 least recently updated stale tickets.</param>
public sealed record StaleTicketsDto(int Count, int OlderThanDays, DateTimeOffset UpdatedBefore, IReadOnlyList<DashboardTicketDto> Oldest);

public sealed record ProgressDto(int Done, int Total);

/// <param name="Children">Direct, non-deleted children done/total by count.</param>
/// <param name="Points">The same children by story points (nulls ignored).</param>
public sealed record EpicProgressItemDto(string Key, string Title, TicketStatus Status, Priority Priority, ProgressDto Children, ProgressDto Points);

/// <param name="OpenEpics">All open epics in scope; <paramref name="Epics"/> lists at most 50 of them, by priority then key.</param>
public sealed record EpicProgressDto(int OpenEpics, IReadOnlyList<EpicProgressItemDto> Epics);

public sealed record TestCaseStatusCountDto(TestCaseStatus Status, int Count);

/// <param name="AutomationRatio">Automatic / (Manual + Automatic); null when there are neither.</param>
public sealed record TestCaseStatsDto(int Total, IReadOnlyList<TestCaseStatusCountDto> ByStatus, double? AutomationRatio);

/// <summary>Session summary of spec 6.11. <c>PassRate</c> = passed / (passed + failed), null before any pass or fail.</summary>
public sealed record RegressionSessionSummaryDto(
    string Key,
    string Name,
    string? Version,
    RegressionSessionStatus Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    int Total,
    int Passed,
    int PassedManual,
    int PassedAutomatic,
    int Failed,
    int Skipped,
    int Waiting,
    double? PassRate,
    int BugsCreated);

public sealed record RegressionPassRateDto(string Key, string Name, string? Version, DateTimeOffset CompletedAt, int Passed, int Failed, double? PassRate);

/// <param name="Latest">The most recently started session that was not cancelled.</param>
/// <param name="RecentPassRates">The last 5 completed sessions, oldest first.</param>
public sealed record RegressionStatsDto(RegressionSessionSummaryDto? Latest, IReadOnlyList<RegressionPassRateDto> RecentPassRates);

/// <param name="Items">The 10 most important open regression bugs (priority, then severity, then key).</param>
public sealed record RegressionBugsDto(int Count, IReadOnlyList<DashboardTicketDto> Items);

/// <param name="Total">Non-deleted pages and diagrams of the project (folders are not counted).</param>
/// <param name="Items">The 5 most recently updated of them, newest first.</param>
public sealed record RecentDocsDto(int Total, IReadOnlyList<DocSummaryDto> Items);
