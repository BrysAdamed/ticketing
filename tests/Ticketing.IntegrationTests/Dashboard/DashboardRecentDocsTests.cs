using System.Net;
using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Dashboard;
using Ticketing.Application.Docs;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Docs;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Dashboard;

[Collection(nameof(DashboardCollection))]
public sealed class DashboardRecentDocsTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_project_without_docs_has_an_empty_recent_docs_widget()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.CreateProjectAsync("RDE", owner);
        var client = await api.LoginAsync(owner);
        await client.CreateFolderAsync("RDE", "Only a folder");

        // Act
        var dashboard = await GetAsync(client, "RDE");

        // Assert
        Assert.Equal(0, dashboard.RecentDocs.Total);
        Assert.Empty(dashboard.RecentDocs.Items);
    }

    [Fact]
    public async Task Recent_docs_are_the_five_latest_pages_and_diagrams_with_the_total_count()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.CreateProjectAsync("RDS", owner);
        var client = await api.LoginAsync(owner);
        var folder = await client.CreateFolderAsync("RDS", "Guides");
        var pages = new List<DocDto>();
        for (var i = 1; i <= 6; i++)
            pages.Add(await client.CreatePageAsync("RDS", $"Page {i}", folder.Key, $"Body {i}"));
        var diagram = await client.CreateDocAsync("RDS", new { kind = "Diagram", diagramFormat = "Mermaid", title = "Flow", content = "flowchart LR\n  a --> b" });
        var deleted = await client.CreatePageAsync("RDS", "Gone");
        (await client.DeleteAsync($"/api/v1/docs/{deleted.Key}", _ct)).EnsureSuccessStatusCode();
        (await client.PatchDocAsync(pages[0].Key, new { content = "Body 1, revised", baseVersion = 1 })).EnsureSuccessStatusCode();

        // Act
        var dashboard = await GetAsync(client, "RDS", version: "9.9");

        // Assert
        Assert.Equal(7, dashboard.RecentDocs.Total);
        Assert.Equal(
            [pages[0].Key, diagram.Key, pages[5].Key, pages[4].Key, pages[3].Key],
            dashboard.RecentDocs.Items.Select(d => d.Key));
        var latest = dashboard.RecentDocs.Items[0];
        Assert.Equal("Guides/Page 1", latest.Path);
        Assert.Equal(2, latest.Version);
        Assert.Equal(owner.Email, latest.UpdatedBy.Email);
        Assert.Equal(DiagramFormat.Mermaid, dashboard.RecentDocs.Items[1].DiagramFormat);
    }

    [Theory]
    [InlineData("viewer", true)]
    [InlineData("outsider", false)]
    public async Task Recent_docs_of_a_private_project_reach_only_its_readers(string who, bool readable)
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        await api.CreateProjectAsync("RDP", owner, ProjectVisibility.Private, (viewer, ProjectRole.Viewer));
        await api.CreateProjectAsync("RDO", outsider, ProjectVisibility.Public);
        var ownerClient = await api.LoginAsync(owner);
        await ownerClient.CreatePageAsync("RDP", "Secret plan", content: "Do not share");
        var client = await api.LoginAsync(who == "viewer" ? viewer : outsider);

        // Act
        var privateDashboard = await client.GetAsync("/api/v1/projects/RDP/dashboard", _ct);
        var ownDashboard = await (await api.LoginAsync(outsider)).GetAsync("/api/v1/projects/RDO/dashboard", _ct);

        // Assert
        if (readable)
            Assert.Equal("Secret plan", Assert.Single((await privateDashboard.ReadAsync<ProjectDashboardDto>()).RecentDocs.Items).Title);
        else
            await privateDashboard.ShouldBeProblemAsync(HttpStatusCode.NotFound, "project.notFound");
        var other = (await ownDashboard.ReadAsync<ProjectDashboardDto>()).RecentDocs;
        Assert.Equal(0, other.Total);
        Assert.Empty(other.Items);
    }

    [Fact]
    public async Task Get_project_stats_returns_recent_docs_to_a_read_only_token()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.CreateProjectAsync("RDM", owner);
        var page = await (await api.LoginAsync(owner)).CreatePageAsync("RDM", "Runbook", content: "Steps");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(owner, PatScope.ReadOnly));

        // Act
        var result = await mcp.CallToolAsync("get_project_stats", new Dictionary<string, object?> { ["projectKey"] = "RDM" }, cancellationToken: _ct);

        // Assert
        Assert.NotEqual(true, result.IsError);
        var recent = Payload(result).GetProperty("recentDocs");
        Assert.Equal(1, recent.GetProperty("total").GetInt32());
        var item = recent.GetProperty("items")[0];
        Assert.Equal(page.Key, item.GetProperty("key").GetString());
        Assert.Equal("Page", item.GetProperty("kind").GetString());
    }

    private async Task<ProjectDashboardDto> GetAsync(HttpClient client, string projectKey, string? version = null)
    {
        var url = $"/api/v1/projects/{projectKey}/dashboard" + (version is null ? string.Empty : $"?version={Uri.EscapeDataString(version)}");
        return await (await client.GetAsync(url, _ct)).ReadAsync<ProjectDashboardDto>();
    }

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
}
