using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Dashboard;

[Collection(nameof(DashboardCollection))]
public sealed class DashboardMcpTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Get_project_stats_returns_the_dashboard_with_the_version_filter()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var project = await api.CreateProjectAsync("MCP", owner);
        await api.AddTicketsAsync(project, owner.Id,
            new TicketSeed(1, TicketType.Bug) { Version = "1.0" },
            new TicketSeed(2, TicketType.Bug, TicketStatus.Done) { Version = "2.0" });
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(owner, PatScope.ReadOnly));

        // Act
        var all = await mcp.CallToolAsync("get_project_stats", new Dictionary<string, object?> { ["projectKey"] = "MCP" }, cancellationToken: _ct);
        var filtered = await mcp.CallToolAsync(
            "get_project_stats", new Dictionary<string, object?> { ["projectKey"] = "mcp", ["version"] = "1.0" }, cancellationToken: _ct);

        // Assert
        Assert.NotEqual(true, all.IsError);
        var totals = Payload(all).GetProperty("totals");
        Assert.Equal(1, totals.GetProperty("openTickets").GetInt32());
        Assert.Equal(1, totals.GetProperty("doneTickets").GetInt32());
        Assert.Equal("ToDo", Payload(all).GetProperty("byStatus")[0].GetProperty("status").GetString());
        var filteredBody = Payload(filtered);
        Assert.Equal("1.0", filteredBody.GetProperty("version").GetString());
        Assert.Equal(0, filteredBody.GetProperty("totals").GetProperty("doneTickets").GetInt32());
    }

    [Fact]
    public async Task Get_project_stats_on_a_private_project_of_someone_else_is_not_found()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.CreateProjectAsync("SECRET", owner);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(await api.CreateUserAsync(), PatScope.ReadOnly));

        // Act
        var result = await mcp.CallToolAsync("get_project_stats", new Dictionary<string, object?> { ["projectKey"] = "SECRET" }, cancellationToken: _ct);

        // Assert
        Assert.True(result.IsError);
        Assert.Equal("project.notFound", Payload(result).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Get_project_stats_is_a_read_only_tool_listing_its_enum_values()
    {
        // Arrange
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(await api.CreateUserAsync(), PatScope.ReadOnly));

        // Act
        var tool = (await mcp.ListToolsAsync(cancellationToken: _ct)).Single(t => t.Name == "get_project_stats");

        // Assert
        Assert.True(tool.ProtocolTool.Annotations?.ReadOnlyHint);
        Assert.Contains("ReadyForTesting", tool.Description);
        Assert.Contains("Automatic", tool.Description);
    }

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
}
