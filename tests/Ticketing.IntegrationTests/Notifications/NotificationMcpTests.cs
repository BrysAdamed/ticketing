using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Notifications;

[Collection(nameof(NotificationsCollection))]
public sealed class NotificationMcpTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task List_and_mark_notifications_read_over_mcp()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "First", extra: new { assignee = world.Member.Email });
        await world.OwnerClient.CreateTicketAsync("WEB", "Second", extra: new { assignee = world.Member.Email });
        await world.OwnerClient.CreateTicketAsync("WEB", "Third", extra: new { assignee = world.Member.Email });
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Member));

        // Act
        var page = await CallAsync(mcp, "list_notifications", new() { ["limit"] = 2 });
        var next = await CallAsync(mcp, "list_notifications", new() { ["limit"] = 2, ["cursor"] = page.GetProperty("nextCursor").GetString() });
        var firstId = page.GetProperty("items")[0].GetProperty("id").GetString();
        var markedOne = await CallAsync(mcp, "mark_notifications_read", new() { ["ids"] = new[] { firstId } });
        var unread = await CallAsync(mcp, "list_notifications", new() { ["unreadOnly"] = true });
        var markedAll = await CallAsync(mcp, "mark_notifications_read", new() { ["all"] = true });
        var invalid = await mcp.CallToolAsync("mark_notifications_read", new Dictionary<string, object?>(), cancellationToken: _ct);

        // Assert
        var items = page.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(["WEB-3", "WEB-2"], items.Select(i => i.GetProperty("ticket").GetProperty("key").GetString()));
        Assert.Equal("Assigned", items[0].GetProperty("kind").GetString());
        Assert.Equal("assigned the ticket to you", items[0].GetProperty("summary").GetString());
        Assert.Equal(["WEB-1"], next.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("ticket").GetProperty("key").GetString()));
        Assert.Equal(2, markedOne.GetProperty("unreadCount").GetInt32());
        Assert.Equal(["WEB-2", "WEB-1"], unread.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("ticket").GetProperty("key").GetString()));
        Assert.Equal(0, markedAll.GetProperty("unreadCount").GetInt32());
        Assert.True(invalid.IsError);
        Assert.Contains("validation", Assert.IsType<TextContentBlock>(invalid.Content[0]).Text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Read_only_tokens_list_but_do_not_see_the_mark_read_tool()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Read only", extra: new { assignee = world.Member.Email });
        await using var readOnly = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Member, PatScope.ReadOnly));

        // Act
        var tools = (await readOnly.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).ToList();
        var listed = await CallAsync(readOnly, "list_notifications", []);

        // Assert
        Assert.Contains("list_notifications", tools);
        Assert.DoesNotContain("mark_notifications_read", tools);
        Assert.Single(listed.GetProperty("items").EnumerateArray());
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        Assert.False(result.IsError == true, $"{tool} failed: {(result.Content.FirstOrDefault() as TextContentBlock)?.Text}");
        return JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }
}
