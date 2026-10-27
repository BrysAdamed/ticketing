using System.Globalization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Dashboard;

/// <summary>
/// The project dashboard (spec 7): every widget in one response. Deleted tickets never count, cancelled sessions are
/// left out of regression summaries, and the optional version filter applies to ticket widgets only (I-23).
/// </summary>
public static class GetProjectDashboard
{
    public const int Weeks = 12;
    public const int StaleAfterDays = 30;
    public const int TopAssignees = 10;
    public const int StaleListSize = 10;
    public const int MaxEpics = 50;
    public const int RecentCompletedSessions = 5;
    public const int RegressionBugListSize = 10;

    /// <param name="ProjectKeyOrId">A project key (<c>WEB</c>) or id.</param>
    /// <param name="Version">Exact ticket version (case-sensitive); null or blank for all versions.</param>
    public sealed record Query(string ProjectKeyOrId, string? Version = null) : IValidatable
    {
        public string? NormalizedVersion => string.IsNullOrWhiteSpace(Version) ? null : Version.Trim();

        public void Validate(Validator validator) => validator.MaxLength("version", Version, Ticket.VersionMaxLength);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, IClock clock) : IHandler<Query, ProjectDashboardDto>
    {
        public async Task<ProjectDashboardDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            request.EnsureValid();
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            var projectId = grant.ProjectId;
            var version = request.NormalizedVersion;
            var now = clock.Now;
            var staleBefore = now.AddDays(-StaleAfterDays);
            var firstWeek = IsoWeekStart(now).AddDays(-7 * (Weeks - 1));
            var firstWeekStart = new DateTimeOffset(firstWeek.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

            var groups = await DashboardQueries.TicketGroupsAsync(db, projectId, version, staleBefore, cancellationToken);
            var weeks = await DashboardQueries.WeeksAsync(db, projectId, version, firstWeekStart, cancellationToken);
            var assignees = await DashboardQueries.TopAssigneesAsync(db, projectId, version, TopAssignees, cancellationToken);
            var stale = await DashboardQueries.StaleTicketsAsync(db, projectId, version, staleBefore, StaleListSize, cancellationToken);
            var epics = await DashboardQueries.EpicsAsync(db, projectId, version, MaxEpics, cancellationToken);
            var testCases = await DashboardQueries.TestCasesAsync(db, projectId, cancellationToken);
            var sessions = await DashboardQueries.SessionsAsync(db, projectId, RecentCompletedSessions, cancellationToken);
            var bugs = await DashboardQueries.RegressionBugsAsync(db, projectId, version, RegressionBugListSize, cancellationToken);

            var key = grant.ProjectKey;
            var open = groups.Where(g => g.Status.IsOpen()).ToList();
            var openCount = open.Sum(g => g.Count);
            var unassigned = open.Where(g => g.Unassigned).Sum(g => g.Count);

            return new ProjectDashboardDto(
                key,
                version,
                now,
                new DashboardTotalsDto(openCount, groups.Where(g => !g.Status.IsOpen()).Sum(g => g.Count), open.Sum(g => g.StoryPoints), unassigned),
                Enum.GetValues<TicketStatus>().Select(s => new StatusCountDto(s, s.Category(), groups.Where(g => g.Status == s).Sum(g => g.Count))).ToList(),
                Enum.GetValues<TicketType>().Select(t => new TypeCountDto(t, open.Where(g => g.Type == t).Sum(g => g.Count))).ToList(),
                Enum.GetValues<Priority>().Select(p => new PriorityCountDto(p, open.Where(g => g.Priority == p).Sum(g => g.Count))).ToList(),
                SeverityBuckets().Select(s => new SeverityCountDto(s, open.Where(g => g.Type == TicketType.Bug && g.Severity == s).Sum(g => g.Count))).ToList(),
                WeekSeries(firstWeek, weeks),
                new OpenByAssigneeDto(
                    assignees.Select(a => new AssigneeCountDto(new DashboardUserDto(a.Id, a.Email, a.DisplayName, a.IsActive), a.Count)).ToList(),
                    unassigned,
                    openCount - unassigned - assignees.Sum(a => a.Count)),
                new StaleTicketsDto(open.Where(g => g.Stale).Sum(g => g.Count), StaleAfterDays, staleBefore, stale.Select(t => ToTicket(key, t)).ToList()),
                new EpicProgressDto(
                    epics.Count == 0 ? 0 : epics[0].Total,
                    epics.Select(e => new EpicProgressItemDto(
                        HumanKeys.Ticket(key, e.Number), e.Title, e.Status, e.Priority,
                        new ProgressDto(e.ChildrenDone, e.ChildrenTotal), new ProgressDto(e.PointsDone, e.PointsTotal))).ToList()),
                TestCaseStats(testCases),
                RegressionStats(key, sessions),
                new RegressionBugsDto(bugs.Count == 0 ? 0 : bugs[0].Total, bugs.Select(t => ToTicket(key, t)).ToList()));
        }

        private static IEnumerable<Severity?> SeverityBuckets() => Enum.GetValues<Severity>().Select(s => (Severity?)s).Append(null);

        private static DateOnly IsoWeekStart(DateTimeOffset now)
        {
            var today = DateOnly.FromDateTime(now.UtcDateTime);
            return today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        }

        private static List<WeekCountDto> WeekSeries(DateOnly firstWeek, List<WeekRow> rows) =>
            Enumerable.Range(0, Weeks)
                .Select(i => firstWeek.AddDays(7 * i))
                .Select(start =>
                {
                    var row = rows.FirstOrDefault(r => r.WeekStart == start);
                    var date = start.ToDateTime(TimeOnly.MinValue);
                    var label = string.Create(CultureInfo.InvariantCulture, $"{ISOWeek.GetYear(date)}-W{ISOWeek.GetWeekOfYear(date):00}");
                    return new WeekCountDto(start, label, row?.Created ?? 0, row?.Resolved ?? 0);
                })
                .ToList();

        private static TestCaseStatsDto TestCaseStats(List<TestCaseRow> rows)
        {
            int CountOf(TestCaseStatus status) => rows.Where(r => r.Status == status).Sum(r => r.Count);
            var manual = CountOf(TestCaseStatus.Manual);
            var automatic = CountOf(TestCaseStatus.Automatic);
            return new TestCaseStatsDto(
                rows.Sum(r => r.Count),
                Enum.GetValues<TestCaseStatus>().Select(s => new TestCaseStatusCountDto(s, CountOf(s))).ToList(),
                manual + automatic == 0 ? null : (double)automatic / (manual + automatic));
        }

        private static RegressionStatsDto RegressionStats(string projectKey, List<SessionRow> sessions)
        {
            var latest = sessions
                .Where(s => s.Status != RegressionSessionStatus.Cancelled)
                .OrderByDescending(s => s.StartedAt)
                .ThenByDescending(s => s.Number)
                .FirstOrDefault();
            var recent = sessions
                .Where(s => s.Status == RegressionSessionStatus.Completed && s.CompletedAt is not null)
                .OrderByDescending(s => s.CompletedAt)
                .ThenByDescending(s => s.Number)
                .Take(RecentCompletedSessions)
                .Reverse()
                .Select(s =>
                {
                    var summary = Summary(s);
                    return new RegressionPassRateDto(
                        HumanKeys.Regression(projectKey, s.Number), s.Name, s.Version, s.CompletedAt!.Value, summary.Passed, summary.Failed, summary.PassRate);
                })
                .ToList();
            return new RegressionStatsDto(latest is null ? null : ToSessionSummary(projectKey, latest), recent);
        }

        private static RegressionSummary Summary(SessionRow s) =>
            new(s.Total, s.PassedManual, s.PassedAutomatic, s.Failed, s.Skipped, s.Waiting, s.BugsCreated);

        private static RegressionSessionSummaryDto ToSessionSummary(string projectKey, SessionRow s)
        {
            var summary = Summary(s);
            return new RegressionSessionSummaryDto(
                HumanKeys.Regression(projectKey, s.Number), s.Name, s.Version, s.Status, s.StartedAt, s.CompletedAt,
                summary.Total, summary.Passed, summary.PassedManual, summary.PassedAutomatic, summary.Failed, summary.Skipped,
                summary.Waiting, summary.PassRate, summary.BugsCreated);
        }

        private static DashboardTicketDto ToTicket(string projectKey, TicketRow t) => new(
            HumanKeys.Ticket(projectKey, t.Number), t.Title, t.Type, t.Status, t.Priority, t.Severity,
            t.AssigneeId is { } id ? new DashboardUserDto(id, t.AssigneeEmail!, t.AssigneeName!, t.AssigneeActive ?? true) : null,
            t.UpdatedAt);
    }
}
