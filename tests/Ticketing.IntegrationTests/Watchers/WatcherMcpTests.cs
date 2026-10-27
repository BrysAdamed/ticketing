using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Watchers;

[Collection(nameof(WatchersCollection))]
public sealed class WatcherMcpTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Watch_unwatch_and_get_ticket_watchers_over_mcp()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Via MCP");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Viewer));

        // Act
        var watched = await CallAsync(mcp, "watch_ticket", new() { ["key"] = "WEB-1" });
        var ticket = await CallAsync(mcp, "get_ticket", new() { ["key"] = "WEB-1", ["include"] = new[] { "watchers" } });
        var search = await CallAsync(mcp, "search_tickets", new() { ["watching"] = true });
        var unwatched = await CallAsync(mcp, "unwatch_ticket", new() { ["key"] = "WEB-1" });
        var hidden = await mcp.CallToolAsync("watch_ticket", new Dictionary<string, object?> { ["key"] = "NOPE-1" }, cancellationToken: _ct);

        // Assert
        Assert.Equal((2, true), (watched.GetProperty("count").GetInt32(), watched.GetProperty("watching").GetBoolean()));
        var users = ticket.GetProperty("watchers").GetProperty("users").EnumerateArray().Select(u => u.GetProperty("email").GetString()).ToList();
        Assert.Equal(2, users.Count);
        Assert.Contains(world.Viewer.Email, users);
        Assert.Equal(["WEB-1"], search.GetProperty("items").EnumerateArray().Select(t => t.GetProperty("key").GetString()));
        Assert.Equal((1, false), (unwatched.GetProperty("count").GetInt32(), unwatched.GetProperty("watching").GetBoolean()));
        Assert.True(hidden.IsError);
        Assert.Contains("ticket.notFound", Assert.IsType<TextContentBlock>(hidden.Content[0]).Text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Tickets_created_and_commented_over_mcp_are_watched_automatically()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Member));

        // Act
        var created = await CallAsync(mcp, "create_ticket", new() { ["projectKey"] = "WEB", ["title"] = "Model made", ["type"] = "Bug", ["assignee"] = world.Owner.Email });
        await world.OwnerClient.CreateTicketAsync("WEB", "Owner made");
        await CallAsync(mcp, "add_comment", new() { ["key"] = "WEB-2", ["body"] = "Seen" });
        var first = await world.OwnerClient.WatchersAsync("WEB-1");
        var second = await world.OwnerClient.WatchersAsync("WEB-2");

        // Assert
        Assert.Equal("WEB-1", created.GetProperty("key").GetString());
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), first.Ids().OrderBy(id => id));
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), second.Ids().OrderBy(id => id));
    }

    [Fact]
    public async Task Read_only_tokens_do_not_see_the_watch_tools()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await using var readOnly = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Member, PatScope.ReadOnly));
        await using var readWrite = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Member));

        // Act
        var readOnlyTools = (await readOnly.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).ToList();
        var readWriteTools = (await readWrite.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).ToList();

        // Assert
        Assert.DoesNotContain("watch_ticket", readOnlyTools);
        Assert.DoesNotContain("unwatch_ticket", readOnlyTools);
        Assert.Contains("watch_ticket", readWriteTools);
        Assert.Contains("unwatch_ticket", readWriteTools);
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        Assert.False(result.IsError == true, $"{tool} failed: {(result.Content.FirstOrDefault() as TextContentBlock)?.Text}");
        return JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }
}
