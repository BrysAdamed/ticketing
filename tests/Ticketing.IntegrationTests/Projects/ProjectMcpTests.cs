using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Projects;

[Collection(nameof(ProjectsCollection))]
public sealed class ProjectMcpTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Update_project_changes_supplied_fields_and_empty_description_clears_it()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "WEB");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(owner));
        await mcp.CallToolAsync("update_project", Args(("projectKey", "WEB"), ("description", "Initial")), cancellationToken: _ct);

        // Act
        var result = await mcp.CallToolAsync("update_project", Args(("projectKey", "web"), ("visibility", "Public"), ("description", "")), cancellationToken: _ct);

        // Assert
        Assert.NotEqual(true, result.IsError);
        var body = Payload(result);
        Assert.Equal("Public", body.GetProperty("visibility").GetString());
        Assert.Equal("WEB project", body.GetProperty("name").GetString());
        Assert.False(body.TryGetProperty("description", out var description) && description.ValueKind != JsonValueKind.Null);
    }

    [Fact]
    public async Task Update_project_reports_stale_versions_and_non_owners_as_tool_errors()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "WEB", ProjectVisibility.Private, (member, ProjectRole.Member));
        await using var ownerMcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(owner));
        await using var memberMcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(member));

        // Act
        var stale = await ownerMcp.CallToolAsync("update_project", Args(("projectKey", "WEB"), ("name", "X"), ("expectedVersion", 1)), cancellationToken: _ct);
        var forbidden = await memberMcp.CallToolAsync("update_project", Args(("projectKey", "WEB"), ("name", "X")), cancellationToken: _ct);

        // Assert
        Assert.Equal("concurrency.conflict", Payload(stale).GetProperty("code").GetString());
        Assert.Equal(ProjectErrors.Forbidden, Payload(forbidden).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Get_project_returns_members_with_effective_roles_and_linked_boards()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var projectId = await api.ProjectAsync(owner, "PUB", ProjectVisibility.Public, (viewer, ProjectRole.Viewer));
        await api.BoardAsync(owner, "Team board", projectId);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(viewer, PatScope.ReadOnly));

        // Act
        var result = await mcp.CallToolAsync("get_project", Args(("projectKey", "PUB")), cancellationToken: _ct);
        var list = await mcp.CallToolAsync("list_projects", Args(("mine", true)), cancellationToken: _ct);

        // Assert
        var body = Payload(result);
        var viewerRow = body.GetProperty("members").EnumerateArray().Single(m => m.GetProperty("userId").GetGuid() == viewer.Id);
        Assert.Equal(("Viewer", "Member"), (viewerRow.GetProperty("role").GetString(), viewerRow.GetProperty("effectiveRole").GetString()));
        Assert.Equal("Team board", body.GetProperty("boards")[0].GetProperty("name").GetString());
        Assert.Equal("PUB", Payload(list).GetProperty("items")[0].GetProperty("key").GetString());
    }

    private static Dictionary<string, object?> Args(params (string Name, object? Value)[] args) => args.ToDictionary(a => a.Name, a => a.Value);

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
}
