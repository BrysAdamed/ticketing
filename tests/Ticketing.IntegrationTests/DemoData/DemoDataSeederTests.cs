using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Ticketing.Api.DemoData;
using Ticketing.Application.Dashboard;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Dashboard;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.DemoData;

[CollectionDefinition(nameof(DemoDataCollection))]
public sealed class DemoDataCollection : ICollectionFixture<TicketingApiFactory>;

[Collection(nameof(DemoDataCollection))]
public sealed class DemoDataSeederTests(TicketingApiFactory api)
{
    private const string DemoPassword = "Demo-Workspace-Password-2026";

    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Seeding_a_fresh_database_creates_the_demo_workspace_once()
    {
        // Arrange
        await api.CreateUserAsync(GlobalRole.Admin);
        await using var host = api.WithWebHostBuilder(b => b.UseSetting(DemoDataSetup.PasswordVariable, DemoPassword));
        var seeder = host.Services.GetRequiredService<DemoDataSeeder>();

        // Act
        var first = await seeder.SeedAsync(_ct);
        var afterFirst = await CountAsync();
        var second = await seeder.SeedAsync(_ct);
        var afterSecond = await CountAsync();

        // Assert
        Assert.True(first.Seeded, first.Message);
        Assert.False(second.Seeded);
        Assert.Equal(afterFirst, afterSecond);
        Assert.Equal(7, afterFirst.Users);
        Assert.Equal(3, afterFirst.Projects);
        Assert.Equal(180, afterFirst.Tickets);
        Assert.Equal(2, afterFirst.Boards);
        Assert.Equal(26, afterFirst.TestCases);
        Assert.Equal(2, afterFirst.Sessions);
        Assert.Equal(3, afterFirst.Flags);
        Assert.InRange(afterFirst.Comments, 60, 200);
        Assert.InRange(afterFirst.Links, 10, 40);

        await api.WithDbAsync(async db =>
        {
            var tickets = await db.Tickets.AsNoTracking().ToListAsync(_ct);
            var byStatus = string.Join(", ", tickets.GroupBy(t => t.Status).OrderBy(g => g.Key).Select(g => $"{g.Key}={g.Count()}"));
            Assert.True(tickets.Select(t => t.Status).Distinct().Count() == 8, byStatus);
            Assert.Contains(tickets, t => t.Resolution is Resolution.WontDo or Resolution.Duplicate or Resolution.CannotReproduce);
            Assert.All(tickets.Where(t => t.Status == TicketStatus.Done), t => Assert.NotNull(t.ResolvedAt));
            Assert.Equal(17, tickets.Count(t => t.Type == TicketType.Epic));
            Assert.Contains(tickets, t => t.ParentId is { } parent && tickets.Single(p => p.Id == parent).ParentId is not null);
            Assert.True(tickets.Count(t => t.BoardId is not null) >= 20);
            Assert.True(tickets.Min(t => t.CreatedAt) < DateTimeOffset.UtcNow.AddDays(-70));
            Assert.True(tickets.Count(t => t.Status != TicketStatus.Done && t.UpdatedAt < DateTimeOffset.UtcNow.AddDays(-30)) > 0);

            var sessions = await db.RegressionSessions.AsNoTracking().Include(s => s.Items).ToListAsync(_ct);
            Assert.Equal([RegressionSessionStatus.InProgress, RegressionSessionStatus.Completed], sessions.Select(s => s.Status).Order());
            Assert.Contains(sessions.Single(s => s.Status == RegressionSessionStatus.Completed).Items,
                i => i.Status == RegressionItemStatus.Failed && i.BugTicketId is not null);

            var ops = await db.Projects.AsNoTracking().SingleAsync(p => p.Key == "OPS", _ct);
            Assert.Equal(ProjectVisibility.Private, ops.Visibility);
            Assert.True(await db.ActivityEntries.CountAsync(_ct) > afterFirst.Tickets * 2);
            return true;
        });
    }

    [Fact]
    public async Task Startup_seeding_fills_the_dashboard_and_demo_users_can_sign_in()
    {
        // Arrange
        await api.CreateUserAsync(GlobalRole.Admin);
        await using var host = api.WithWebHostBuilder(b => b
            .UseSetting(DemoDataSetup.SeedVariable, "true")
            .UseSetting(DemoDataSetup.PasswordVariable, DemoPassword));

        // Act
        _ = host.Server;
        var maya = await api.WithDbAsync(db => db.Users.AsNoTracking().SingleAsync(u => u.Email == "maya.kowalczyk@example.com", _ct));
        var client = await api.LoginAsync(new TestUser(maya.Id, maya.Email, DemoPassword, maya.DisplayName, maya.GlobalRole));
        var dashboard = await (await client.GetAsync("/api/v1/projects/PAY/dashboard", _ct)).ReadAsync<ProjectDashboardDto>();

        // Assert
        Assert.True(dashboard.Totals.OpenTickets > 0);
        Assert.True(dashboard.Totals.DoneTickets > 0);
        Assert.True(dashboard.CreatedVsResolved.Count(w => w.Created > 0) >= 6);
        Assert.True(dashboard.CreatedVsResolved.Count(w => w.Resolved > 0) >= 4);
        Assert.NotEmpty(dashboard.OpenByAssignee.Top);
        Assert.True(dashboard.Stale.Count > 0);
        Assert.NotEmpty(dashboard.EpicProgress.Epics);
        Assert.Equal(16, dashboard.TestCases.Total);
        Assert.NotNull(dashboard.Regressions.Latest);
        Assert.NotEmpty(dashboard.Regressions.RecentPassRates);
        Assert.Equal(1, dashboard.RegressionBugs.Count);
    }

    [Fact]
    public async Task A_workspace_with_projects_is_never_touched()
    {
        // Arrange
        var owner = await api.CreateUserAsync(GlobalRole.Admin);
        await api.CreateProjectAsync("OWN", owner);
        var seeder = api.Services.GetRequiredService<DemoDataSeeder>();
        var before = await CountAsync();

        // Act
        var result = await seeder.SeedAsync(_ct);

        // Assert
        Assert.False(result.Seeded);
        Assert.Equal(before, await CountAsync());
    }

    private Task<Counts> CountAsync() => api.WithDbAsync(async db => new Counts(
        await db.Users.CountAsync(_ct),
        await db.Projects.CountAsync(_ct),
        await db.Tickets.CountAsync(_ct),
        await db.Boards.CountAsync(_ct),
        await db.TestCases.CountAsync(_ct),
        await db.RegressionSessions.CountAsync(_ct),
        await db.FeatureFlags.CountAsync(_ct),
        await db.Comments.CountAsync(_ct),
        await db.TicketLinks.CountAsync(_ct)));

    private sealed record Counts(int Users, int Projects, int Tickets, int Boards, int TestCases, int Sessions, int Flags, int Comments, int Links);
}
