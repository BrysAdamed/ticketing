using System.Net;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Search;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Search;

/// <summary>Spec 10: private-project data never leaks through search, export, quick jump, My work or MCP.</summary>
[Collection(nameof(SearchCollection))]
public sealed class SearchLeakTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Search_returns_only_readable_projects_per_role()
    {
        // Arrange
        var world = await SeedWorldAsync();

        // Act
        var asAdmin = await (await api.LoginAsync(world.Admin)).SearchKeysAsync("sort=key");
        var asViewer = await (await api.LoginAsync(world.Viewer)).SearchKeysAsync("sort=key");
        var asOutsider = await (await api.LoginAsync(world.Outsider)).SearchKeysAsync("sort=key");

        // Assert
        Assert.Equal(["PRIV-1", "PUB-1"], asAdmin);
        Assert.Equal(["PRIV-1", "PUB-1"], asViewer);
        Assert.Equal(["PUB-1"], asOutsider);
    }

    [Fact]
    public async Task References_to_private_data_match_nothing_and_do_not_reveal_existence()
    {
        // Arrange
        var world = await SeedWorldAsync();
        var outsider = await api.LoginAsync(world.Outsider);

        // Act
        var byProject = await outsider.SearchAsync("project=PRIV");
        var byUnknownProject = await outsider.SearchAsync("project=NOPE");
        var byParent = await outsider.SearchAsync("parent=PRIV-1");
        var byKeyText = await outsider.SearchAsync("q=PRIV-1");
        var byTitle = await outsider.SearchAsync("q=secret");
        var byGoneProject = await outsider.SearchAsync("project=GONE");

        // Assert
        Assert.All([byProject, byUnknownProject, byParent, byKeyText, byTitle, byGoneProject], page =>
        {
            Assert.Empty(page.Items);
            Assert.Equal(0, page.Total);
        });
    }

    [Fact]
    public async Task Export_quick_jump_and_my_work_hide_private_projects()
    {
        // Arrange
        var world = await SeedWorldAsync();
        var outsider = await api.LoginAsync(world.Outsider);
        await api.SeedRegressionAsync(world.PrivateProjectId, "PRIV", world.Owner, world.Outsider.Id);

        // Act
        var csv = await outsider.GetStringAsync("/api/v1/tickets/search/export.csv?sort=key", _ct);
        var jumpKey = await (await outsider.GetAsync("/api/v1/quick-jump?q=PRIV-1", _ct)).ReadAsync<List<QuickJumpItem>>();
        var jumpTitle = await (await outsider.GetAsync("/api/v1/quick-jump?q=secret", _ct)).ReadAsync<List<QuickJumpItem>>();
        var jumpTestCase = await (await outsider.GetAsync("/api/v1/quick-jump?q=PRIV-TC-1", _ct)).ReadAsync<List<QuickJumpItem>>();
        var jumpSession = await (await outsider.GetAsync("/api/v1/quick-jump?q=PRIV-R-1", _ct)).ReadAsync<List<QuickJumpItem>>();
        var myWork = await (await outsider.GetAsync("/api/v1/me/work", _ct)).ReadAsync<MyWorkDto>();

        // Assert
        Assert.DoesNotContain("PRIV", csv, StringComparison.Ordinal);
        Assert.Contains("PUB-1", csv, StringComparison.Ordinal);
        Assert.Empty(jumpKey);
        Assert.Empty(jumpTitle);
        Assert.Empty(jumpTestCase);
        Assert.Empty(jumpSession);
        Assert.Equal(["PUB"], myWork.Projects.Select(p => p.ProjectKey));
        Assert.Empty(myWork.RegressionItems);
    }

    [Fact]
    public async Task Losing_membership_removes_tickets_from_search_and_my_work()
    {
        // Arrange
        var world = await SeedWorldAsync();
        await api.WithDbAsync(db => db.Tickets.Where(t => t.ProjectId == world.PrivateProjectId).ExecuteUpdateAsync(s => s.SetProperty(t => t.AssigneeId, world.Viewer.Id), _ct));
        var viewer = await api.LoginAsync(world.Viewer);
        var myWorkBefore = await (await viewer.GetAsync("/api/v1/me/work", _ct)).ReadAsync<MyWorkDto>();
        var before = await viewer.SearchKeysAsync("project=PRIV");
        await api.WithDbAsync(async db =>
        {
            var project = await db.Projects.Include(p => p.Members).SingleAsync(p => p.Id == world.PrivateProjectId, _ct);
            project.RemoveMember(world.Viewer.Id);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var after = await viewer.SearchKeysAsync("project=PRIV");
        var myWork = await (await viewer.GetAsync("/api/v1/me/work", _ct)).ReadAsync<MyWorkDto>();

        // Assert
        Assert.Equal(["PRIV-1"], before);
        Assert.Contains(myWorkBefore.Projects, p => p.ProjectKey == "PRIV");
        Assert.Empty(after);
        Assert.DoesNotContain(myWork.Projects, p => p.ProjectKey == "PRIV");
    }

    [Fact]
    public async Task Anonymous_callers_get_401()
    {
        // Arrange
        var anonymous = api.CreateBrowserClient();

        // Act
        var responses = await Task.WhenAll(
            anonymous.GetAsync("/api/v1/tickets/search", _ct),
            anonymous.GetAsync("/api/v1/tickets/search/export.csv", _ct),
            anonymous.GetAsync("/api/v1/quick-jump?q=x", _ct),
            anonymous.GetAsync("/api/v1/me/work", _ct));

        // Assert
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode));
    }

    private async Task<World> SeedWorldAsync()
    {
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var priv = await api.SeedProjectAsync("PRIV", owner, ProjectVisibility.Private, (viewer, ProjectRole.Viewer));
        var pub = await api.SeedProjectAsync("PUB", owner, ProjectVisibility.Public);
        var gone = await api.SeedProjectAsync("GONE", owner, ProjectVisibility.Public);
        await api.SeedTicketsAsync(priv, owner.Id, new SeedTicket("Secret merger plan") { AssigneeId = outsider.Id });
        await api.SeedTicketsAsync(priv, owner.Id, new SeedTicket("Secret child") { Deleted = true });
        await api.SeedTicketsAsync(pub, owner.Id, new SeedTicket("Public roadmap") { AssigneeId = outsider.Id });
        await api.SeedTicketsAsync(gone, owner.Id, new SeedTicket("Secret in a deleted project") { AssigneeId = outsider.Id });
        await api.WithDbAsync(async db =>
        {
            var project = await db.Projects.SingleAsync(p => p.Id == gone, _ct);
            project.Archive(owner.Id, DateTimeOffset.UtcNow);
            project.Delete(owner.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync(_ct);
        });
        return new World(owner, viewer, outsider, admin, priv);
    }

    private sealed record World(TestUser Owner, TestUser Viewer, TestUser Outsider, TestUser Admin, Guid PrivateProjectId);
}
