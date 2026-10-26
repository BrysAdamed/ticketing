using System.Globalization;
using System.Net;
using Ticketing.Application.Dashboard;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Dashboard;

[Collection(nameof(DashboardCollection))]
public sealed class DashboardEndpointTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task New_project_returns_every_widget_with_zeroes()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.CreateProjectAsync("NEW", owner);
        var client = await api.LoginAsync(owner);

        // Act
        var dashboard = await GetAsync(client, "NEW");

        // Assert
        Assert.Equal("NEW", dashboard.ProjectKey);
        Assert.Null(dashboard.Version);
        Assert.Equal(new DashboardTotalsDto(0, 0, 0, 0), dashboard.Totals);
        Assert.Equal(Enum.GetValues<TicketStatus>(), dashboard.ByStatus.Select(s => s.Status));
        Assert.All(dashboard.ByStatus, s => Assert.Equal(0, s.Count));
        Assert.Equal(5, dashboard.ByType.Count);
        Assert.Equal(5, dashboard.ByPriority.Count);
        Assert.Equal(6, dashboard.OpenBugsBySeverity.Count);
        Assert.Null(dashboard.OpenBugsBySeverity[^1].Severity);
        Assert.Equal(GetProjectDashboard.Weeks, dashboard.CreatedVsResolved.Count);
        Assert.Empty(dashboard.OpenByAssignee.Top);
        Assert.Equal(0, dashboard.Stale.Count);
        Assert.Equal(0, dashboard.EpicProgress.OpenEpics);
        Assert.Null(dashboard.TestCases.AutomationRatio);
        Assert.Null(dashboard.Regressions.Latest);
        Assert.Empty(dashboard.Regressions.RecentPassRates);
        Assert.Equal(0, dashboard.RegressionBugs.Count);
    }

    [Fact]
    public async Task Ticket_widgets_count_open_done_points_and_breakdowns_and_ignore_deleted_tickets()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var anna = await api.CreateUserAsync(displayName: "Anna");
        var project = await api.CreateProjectAsync("TOT", owner);
        await api.AddTicketsAsync(project, owner.Id,
            new TicketSeed(1, TicketType.Bug, TicketStatus.ToDo) { Priority = Priority.High, Severity = Severity.Critical, Points = 3 },
            new TicketSeed(2, TicketType.Bug, TicketStatus.Review) { Points = 5, AssigneeId = anna.Id },
            new TicketSeed(3, TicketType.UserStory, TicketStatus.OnHold) { Priority = Priority.Highest, AssigneeId = anna.Id },
            new TicketSeed(4, TicketType.Technical, TicketStatus.Done) { Points = 8 },
            new TicketSeed(5, TicketType.Bug, TicketStatus.Done) { Severity = Severity.Blocker },
            new TicketSeed(6, TicketType.Bug, TicketStatus.ToDo) { Severity = Severity.Blocker, Points = 13, Deleted = true });
        var client = await api.LoginAsync(owner);

        // Act
        var dashboard = await GetAsync(client, "TOT");

        // Assert
        Assert.Equal(new DashboardTotalsDto(OpenTickets: 3, DoneTickets: 2, OpenStoryPoints: 8, UnassignedOpenTickets: 1), dashboard.Totals);
        Assert.Equal(1, Count(dashboard.ByStatus, TicketStatus.ToDo));
        Assert.Equal(1, Count(dashboard.ByStatus, TicketStatus.Review));
        Assert.Equal(1, Count(dashboard.ByStatus, TicketStatus.OnHold));
        Assert.Equal(2, Count(dashboard.ByStatus, TicketStatus.Done));
        Assert.Equal(StatusCategory.InProgress, dashboard.ByStatus.Single(s => s.Status == TicketStatus.OnHold).Category);
        Assert.Equal(2, dashboard.ByType.Single(t => t.Type == TicketType.Bug).Count);
        Assert.Equal(0, dashboard.ByType.Single(t => t.Type == TicketType.Technical).Count);
        Assert.Equal([1, 1, 1, 0, 0], dashboard.ByPriority.Select(p => p.Count));
        Assert.Equal(1, dashboard.OpenBugsBySeverity.Single(s => s.Severity == Severity.Critical).Count);
        Assert.Equal(1, dashboard.OpenBugsBySeverity.Single(s => s.Severity == null).Count);
        Assert.Equal(0, dashboard.OpenBugsBySeverity.Single(s => s.Severity == Severity.Blocker).Count);
    }

    [Fact]
    public async Task Created_vs_resolved_buckets_by_iso_week_for_the_last_12_weeks()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var project = await api.CreateProjectAsync("WK", owner);
        var now = DateTimeOffset.UtcNow;
        await api.AddTicketsAsync(project, owner.Id,
            new TicketSeed(1) { CreatedAt = now },
            new TicketSeed(2, Status: TicketStatus.Done) { CreatedAt = now.AddDays(-21), ResolvedAt = now },
            new TicketSeed(3) { CreatedAt = now.AddDays(-21) },
            new TicketSeed(4, Status: TicketStatus.Done) { CreatedAt = now.AddDays(-200), ResolvedAt = now.AddDays(-200) },
            new TicketSeed(5) { CreatedAt = now, Deleted = true });
        var client = await api.LoginAsync(owner);

        // Act
        var weeks = (await GetAsync(client, "WK")).CreatedVsResolved;

        // Assert
        var current = weeks[^1];
        Assert.Equal(MondayOf(now), current.WeekStart);
        Assert.Equal(IsoWeek(now), current.IsoWeek);
        Assert.Equal((1, 1), (current.Created, current.Resolved));
        Assert.Equal(2, weeks.Single(w => w.WeekStart == MondayOf(now.AddDays(-21))).Created);
        Assert.Equal(3, weeks.Sum(w => w.Created));
        Assert.Equal(1, weeks.Sum(w => w.Resolved));
        Assert.Equal(MondayOf(now).AddDays(-7 * 11), weeks[0].WeekStart);
    }

    [Fact]
    public async Task Open_by_assignee_lists_top_ten_then_unassigned_and_others()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var project = await api.CreateProjectAsync("ASG", owner);
        var users = new List<TestUser>();
        for (var i = 0; i < 12; i++)
            users.Add(await api.CreateUserAsync(displayName: $"User {i:00}"));
        var seeds = new List<TicketSeed>();
        var number = 0;
        for (var i = 0; i < users.Count; i++)
        {
            for (var n = 0; n < 12 - i; n++)
                seeds.Add(new TicketSeed(++number) { AssigneeId = users[i].Id });
        }
        seeds.Add(new TicketSeed(++number));
        seeds.Add(new TicketSeed(++number, Status: TicketStatus.Done) { AssigneeId = users[0].Id });
        await api.AddTicketsAsync(project, owner.Id, [.. seeds]);
        var client = await api.LoginAsync(owner);

        // Act
        var byAssignee = (await GetAsync(client, "ASG")).OpenByAssignee;

        // Assert
        Assert.Equal(10, byAssignee.Top.Count);
        Assert.Equal("User 00", byAssignee.Top[0].User.DisplayName);
        Assert.Equal(12, byAssignee.Top[0].Count);
        Assert.Equal(users[0].Email, byAssignee.Top[0].User.Email);
        Assert.Equal(1, byAssignee.Unassigned);
        Assert.Equal(2 + 1, byAssignee.Others);
    }

    [Fact]
    public async Task Stale_tickets_are_open_tickets_untouched_for_30_days_oldest_first()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var project = await api.CreateProjectAsync("STL", owner);
        var now = DateTimeOffset.UtcNow;
        var seeds = Enumerable.Range(1, 12)
            .Select(i => new TicketSeed(i) { CreatedAt = now.AddDays(-100), UpdatedAt = now.AddDays(-30 - i) })
            .Append(new TicketSeed(13) { CreatedAt = now.AddDays(-100), UpdatedAt = now.AddDays(-29) })
            .Append(new TicketSeed(14, Status: TicketStatus.Done) { CreatedAt = now.AddDays(-100), UpdatedAt = now.AddDays(-90) })
            .ToArray();
        await api.AddTicketsAsync(project, owner.Id, seeds);
        var client = await api.LoginAsync(owner);

        // Act
        var stale = (await GetAsync(client, "STL")).Stale;

        // Assert
        Assert.Equal(12, stale.Count);
        Assert.Equal(30, stale.OlderThanDays);
        Assert.Equal(10, stale.Oldest.Count);
        Assert.Equal("STL-12", stale.Oldest[0].Key);
        Assert.Equal("STL-3", stale.Oldest[^1].Key);
    }

    [Fact]
    public async Task Epic_progress_counts_direct_children_by_count_and_points()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var project = await api.CreateProjectAsync("EPC", owner);
        await api.AddTicketsAsync(project, owner.Id,
            new TicketSeed(1, TicketType.Epic) { Priority = Priority.Low },
            new TicketSeed(2, TicketType.UserStory, TicketStatus.Done) { ParentNumber = 1, Points = 5 },
            new TicketSeed(3, TicketType.UserStory, TicketStatus.InProgress) { ParentNumber = 1, Points = 3 },
            new TicketSeed(4, TicketType.Bug) { ParentNumber = 1 },
            new TicketSeed(5, TicketType.Bug, TicketStatus.Done) { ParentNumber = 1, Points = 8, Deleted = true },
            new TicketSeed(6, TicketType.Epic) { Priority = Priority.Highest },
            new TicketSeed(7, TicketType.Epic, TicketStatus.Done));
        var client = await api.LoginAsync(owner);

        // Act
        var epics = (await GetAsync(client, "EPC")).EpicProgress;

        // Assert
        Assert.Equal(2, epics.OpenEpics);
        Assert.Equal(["EPC-6", "EPC-1"], epics.Epics.Select(e => e.Key));
        var epic = epics.Epics[1];
        Assert.Equal(new ProgressDto(1, 3), epic.Children);
        Assert.Equal(new ProgressDto(5, 8), epic.Points);
        Assert.Equal(new ProgressDto(0, 0), epics.Epics[0].Children);
    }

    [Fact]
    public async Task Version_filter_applies_to_ticket_widgets_only()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var project = await api.CreateProjectAsync("VER", owner);
        await api.AddTicketsAsync(project, owner.Id,
            new TicketSeed(1, TicketType.Epic),
            new TicketSeed(2, TicketType.UserStory, TicketStatus.Done) { Version = "1.4.0", ParentNumber = 1, Points = 2 },
            new TicketSeed(3, TicketType.UserStory) { Version = "1.5.0", ParentNumber = 1, Points = 3 },
            new TicketSeed(4, TicketType.Bug) { Version = "1.4.0" },
            new TicketSeed(5, TicketType.Bug) { Version = "1.4.0-rc" },
            new TicketSeed(6, TicketType.Epic));
        await api.AddTestCasesAsync(project, owner.Id, @new: 1, manual: 1, automatic: 2);
        var client = await api.LoginAsync(owner);

        // Act
        var all = await GetAsync(client, "VER");
        var filtered = await GetAsync(client, "VER", "1.4.0");

        // Assert
        Assert.Equal(5, all.Totals.OpenTickets);
        Assert.Equal("1.4.0", filtered.Version);
        Assert.Equal(new DashboardTotalsDto(1, 1, 0, 1), filtered.Totals);
        Assert.Equal((2, 1), (filtered.CreatedVsResolved[^1].Created, filtered.CreatedVsResolved[^1].Resolved));
        var epic = Assert.Single(filtered.EpicProgress.Epics);
        Assert.Equal("VER-1", epic.Key);
        Assert.Equal(new ProgressDto(1, 1), epic.Children);
        Assert.Equal(new ProgressDto(2, 2), epic.Points);
        Assert.Equal((4, 2.0 / 3), (filtered.TestCases.Total, filtered.TestCases.AutomationRatio));
    }

    [Fact]
    public async Task Test_case_widget_counts_non_archived_cases_and_automation_ratio()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var project = await api.CreateProjectAsync("TC", owner);
        await api.AddTestCasesAsync(project, owner.Id, @new: 2, manual: 1, automatic: 3, archivedManual: 4);
        var client = await api.LoginAsync(owner);

        // Act
        var testCases = (await GetAsync(client, "TC")).TestCases;

        // Assert
        Assert.Equal(6, testCases.Total);
        Assert.Equal([2, 1, 3], testCases.ByStatus.Select(s => s.Count));
        Assert.Equal(TestCaseStatus.New, testCases.ByStatus[0].Status);
        Assert.Equal(0.75, testCases.AutomationRatio);
    }

    [Fact]
    public async Task Regression_widgets_skip_cancelled_sessions_and_list_open_regression_bugs()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var project = await api.CreateProjectAsync("REG", owner);
        await api.AddTicketsAsync(project, owner.Id,
            new TicketSeed(1, TicketType.Bug) { Priority = Priority.High, Severity = Severity.Major },
            new TicketSeed(2, TicketType.Bug, TicketStatus.Done),
            new TicketSeed(3, TicketType.Bug) { Priority = Priority.Highest },
            new TicketSeed(4, TicketType.Bug));
        var start = DateTimeOffset.UtcNow.AddDays(-30);
        var passed = RegressionItemStatus.Passed;
        var failed = RegressionItemStatus.Failed;
        for (var i = 1; i <= 6; i++)
        {
            await api.AddSessionAsync(project, "REG", owner, new SessionSeed(i, Enumerable.Repeat(passed, i).Append(failed).ToArray())
            {
                StartedAt = start.AddDays(i),
                EndStatus = RegressionSessionStatus.Completed,
                BugTicketNumbers = i == 1 ? [1] : i == 2 ? [2] : [],
            });
        }
        await api.AddSessionAsync(project, "REG", owner, new SessionSeed(7, passed, failed, RegressionItemStatus.WaitingForExecution)
        {
            StartedAt = start.AddDays(10),
            AutomaticCases = 2,
            Version = "2.0",
            BugTicketNumbers = [3],
        });
        await api.AddSessionAsync(project, "REG", owner, new SessionSeed(8, failed)
        {
            StartedAt = start.AddDays(11),
            EndStatus = RegressionSessionStatus.Cancelled,
            BugTicketNumbers = [4],
        });
        var client = await api.LoginAsync(owner);

        // Act
        var dashboard = await GetAsync(client, "REG");

        // Assert
        var latest = dashboard.Regressions.Latest!;
        Assert.Equal("REG-R-7", latest.Key);
        Assert.Equal((5, 3, 1, 2, 1, 1, 1), (latest.Total, latest.Passed, latest.PassedManual, latest.PassedAutomatic, latest.Failed, latest.Waiting, latest.BugsCreated));
        Assert.Equal(0.75, latest.PassRate);
        Assert.Equal(["REG-R-2", "REG-R-3", "REG-R-4", "REG-R-5", "REG-R-6"], dashboard.Regressions.RecentPassRates.Select(r => r.Key));
        Assert.Equal(6.0 / 7, dashboard.Regressions.RecentPassRates[^1].PassRate);
        Assert.Equal(3, dashboard.RegressionBugs.Count);
        Assert.Equal(["REG-3", "REG-1", "REG-4"], dashboard.RegressionBugs.Items.Select(b => b.Key));
    }

    [Theory]
    [InlineData(ProjectVisibility.Private, "owner", HttpStatusCode.OK)]
    [InlineData(ProjectVisibility.Private, "member", HttpStatusCode.OK)]
    [InlineData(ProjectVisibility.Private, "viewer", HttpStatusCode.OK)]
    [InlineData(ProjectVisibility.Private, "admin", HttpStatusCode.OK)]
    [InlineData(ProjectVisibility.Private, "outsider", HttpStatusCode.NotFound)]
    [InlineData(ProjectVisibility.Public, "outsider", HttpStatusCode.OK)]
    public async Task Dashboard_is_readable_by_anyone_who_can_read_the_project(ProjectVisibility visibility, string who, HttpStatusCode expected)
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var users = new Dictionary<string, TestUser>
        {
            ["owner"] = owner,
            ["member"] = member,
            ["viewer"] = viewer,
            ["admin"] = await api.CreateUserAsync(GlobalRole.Admin),
            ["outsider"] = await api.CreateUserAsync(),
        };
        var project = await api.CreateProjectAsync("PRM", owner, visibility, (member, ProjectRole.Member), (viewer, ProjectRole.Viewer));
        await api.AddTicketsAsync(project, owner.Id, new TicketSeed(1) { Version = "1.0" });
        var client = await api.LoginAsync(users[who]);

        // Act
        var dashboard = await client.GetAsync("/api/v1/projects/PRM/dashboard", _ct);

        // Assert
        if (expected == HttpStatusCode.NotFound)
            await dashboard.ShouldBeProblemAsync(HttpStatusCode.NotFound, "project.notFound");
        else
            Assert.Equal(1, (await dashboard.ReadAsync<ProjectDashboardDto>()).Totals.OpenTickets);
    }

    [Fact]
    public async Task Deleted_project_dashboard_is_not_found_even_for_admins()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var project = await api.CreateProjectAsync("DEL", owner);
        await api.DeleteProjectAsync(project, owner.Id);
        var client = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));

        // Act
        var response = await client.GetAsync("/api/v1/projects/DEL/dashboard", _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, "project.notFound");
    }

    [Fact]
    public async Task Dashboard_by_id_works_with_a_read_only_token()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var project = await api.CreateProjectAsync("PAT", owner);
        var client = await api.CreatePatClientAsync(owner, PatScope.ReadOnly);

        // Act
        var response = await client.GetAsync($"/api/v1/projects/{project}/dashboard", _ct);

        // Assert
        Assert.Equal("PAT", (await response.ReadAsync<ProjectDashboardDto>()).ProjectKey);
    }

    [Fact]
    public async Task Too_long_version_is_a_validation_error()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.CreateProjectAsync("VAL", owner);
        var client = await api.LoginAsync(owner);

        // Act
        var response = await client.GetAsync($"/api/v1/projects/VAL/dashboard?version={new string('x', 51)}", _ct);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.True(problem.GetProperty("errors").TryGetProperty("version", out _));
    }

    private async Task<ProjectDashboardDto> GetAsync(HttpClient client, string projectKey, string? version = null)
    {
        var url = $"/api/v1/projects/{projectKey}/dashboard" + (version is null ? string.Empty : $"?version={Uri.EscapeDataString(version)}");
        return await (await client.GetAsync(url, _ct)).ReadAsync<ProjectDashboardDto>();
    }

    private static int Count(IEnumerable<StatusCountDto> counts, TicketStatus status) => counts.Single(c => c.Status == status).Count;

    private static DateOnly MondayOf(DateTimeOffset at)
    {
        var day = DateOnly.FromDateTime(at.UtcDateTime);
        return day.AddDays(-(((int)day.DayOfWeek + 6) % 7));
    }

    private static string IsoWeek(DateTimeOffset at) =>
        string.Create(CultureInfo.InvariantCulture, $"{ISOWeek.GetYear(at.UtcDateTime)}-W{ISOWeek.GetWeekOfYear(at.UtcDateTime):00}");
}
