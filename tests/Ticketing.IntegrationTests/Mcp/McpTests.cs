using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Mcp;

[Collection(nameof(ApiCollection))]
public sealed class McpTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Whoami_returns_the_token_user_scope_and_expiry()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));

        // Act
        var result = await mcp.CallToolAsync("whoami", cancellationToken: _ct);

        // Assert
        Assert.NotEqual(true, result.IsError);
        var body = Payload(result);
        Assert.Equal(user.Email, body.GetProperty("email").GetString());
        Assert.Equal("User", body.GetProperty("globalRole").GetString());
        Assert.Equal("ReadOnly", body.GetProperty("tokenScope").GetString());
        Assert.True(body.GetProperty("tokenExpiresAt").GetDateTimeOffset() > DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task Cookie_session_gets_401_on_mcp()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        var request = new HttpRequestMessage(HttpMethod.Post, "/mcp")
        {
            Content = JsonContent.Create(new { jsonrpc = "2.0", id = 1, method = "tools/list" }),
        };
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.Accept.ParseAdd("text/event-stream");

        // Act
        var response = await client.SendAsync(request, _ct);

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Read_only_token_lists_only_read_tools()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await using var readOnly = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));
        await using var readWrite = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadWrite));

        // Act
        var readOnlyTools = (await readOnly.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).ToList();
        var readWriteTools = (await readWrite.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).ToList();

        // Assert
        Assert.DoesNotContain("create_project", readOnlyTools);
        Assert.Contains("list_projects", readOnlyTools);
        Assert.Contains("create_project", readWriteTools);
    }

    [Fact]
    public async Task Project_tools_create_get_and_list_through_the_same_handlers_as_rest()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));

        // Act
        var created = await mcp.CallToolAsync("create_project",
            new Dictionary<string, object?> { ["key"] = "MCP", ["name"] = "Via MCP", ["visibility"] = "Public" }, cancellationToken: _ct);
        var fetched = await mcp.CallToolAsync("get_project", new Dictionary<string, object?> { ["projectKey"] = "mcp" }, cancellationToken: _ct);
        var listed = await mcp.CallToolAsync("list_projects", cancellationToken: _ct);

        // Assert
        Assert.Equal("Public", Payload(created).GetProperty("visibility").GetString());
        Assert.Equal("Owner", Payload(fetched).GetProperty("myRole").GetString());
        Assert.Equal("MCP", Payload(listed).GetProperty("items")[0].GetProperty("key").GetString());
        var channel = await api.WithDbAsync(db => Task.FromResult(db.ActivityEntries.Single().Channel));
        Assert.Equal(Ticketing.Domain.Activity.WriteChannel.Mcp, channel);
    }

    [Fact]
    public async Task Application_errors_become_code_message_hint_tool_errors()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));

        // Act
        var missing = await mcp.CallToolAsync("get_project", new Dictionary<string, object?> { ["projectKey"] = "NOPE" }, cancellationToken: _ct);
        var invalid = await mcp.CallToolAsync("create_project", new Dictionary<string, object?> { ["key"] = "bad key", ["name"] = "x" }, cancellationToken: _ct);

        // Assert
        Assert.True(missing.IsError);
        Assert.Equal(ProjectErrors.NotFound, Payload(missing).GetProperty("code").GetString());
        Assert.True(invalid.IsError);
        Assert.Equal("validation", Payload(invalid).GetProperty("code").GetString());
    }

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
}
