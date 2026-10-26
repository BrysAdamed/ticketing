using Ticketing.Application.Common;
using Ticketing.Application.Projects;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Projects;

[Collection(nameof(ProjectsCollection))]
public sealed class ProjectListTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task List_returns_counts_per_category_lead_and_membership()
    {
        // Arrange
        var lead = await api.CreateUserAsync(displayName: "Lena Lead");
        var member = await api.CreateUserAsync();
        var projectId = await api.ProjectAsync(lead, "WEB", ProjectVisibility.Private, (member, ProjectRole.Owner));
        await api.TicketsAsync(projectId, lead,
            ("Todo", null, TicketStatus.ToDo),
            ("Doing", null, TicketStatus.Review),
            ("Waiting", null, TicketStatus.OnHold),
            ("Finished", null, TicketStatus.Done));
        var client = await api.LoginAsync(member);

        // Act
        var page = await (await client.GetAsync("/api/v1/projects", _ct)).ReadAsync<CursorPage<ProjectSummaryDto>>();

        // Assert
        var project = Assert.Single(page.Items);
        Assert.Equal((ProjectRole.Owner, true, 3), (project.MyRole, project.IsMember, project.OpenTicketCount));
        Assert.Equal(new TicketCategoryCountsDto(1, 2, 1), project.TicketCounts);
        Assert.Equal(new ProjectLeadDto(lead.Id, "Lena Lead"), project.Lead);
    }

    [Fact]
    public async Task List_filters_by_visibility_and_explicit_membership()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var user = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "MINE", ProjectVisibility.Private, (user, ProjectRole.Viewer));
        await api.ProjectAsync(owner, "OPEN", ProjectVisibility.Public);
        await api.ProjectAsync(owner, "JOINED", ProjectVisibility.Public, (user, ProjectRole.Member));
        await api.ProjectAsync(owner, "HIDDEN", ProjectVisibility.Private);
        var client = await api.LoginAsync(user);
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));

        // Act
        var all = await ListAsync(client, "");
        var mine = await ListAsync(client, "?mine=true");
        var publicOnly = await ListAsync(client, "?visibility=Public");
        var privateOnly = await ListAsync(client, "?visibility=Private");
        var adminPrivate = await ListAsync(admin, "?visibility=Private");

        // Assert
        Assert.Equal(["JOINED", "MINE", "OPEN"], all);
        Assert.Equal(["JOINED", "MINE"], mine);
        Assert.Equal(["JOINED", "OPEN"], publicOnly);
        Assert.Equal(["MINE"], privateOnly);
        Assert.Equal(["HIDDEN", "MINE"], adminPrivate);
    }

    private async Task<List<string>> ListAsync(HttpClient client, string query) =>
        [.. (await (await client.GetAsync($"/api/v1/projects{query}", _ct)).ReadAsync<CursorPage<ProjectSummaryDto>>()).Items.Select(p => p.Key)];
}
