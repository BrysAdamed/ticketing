using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Collaboration;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Notifications;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Mentions;

/// <summary>D-95 over MCP: @email is normalized, get_ticket and list_comments expose mentions, find_users searches readers.</summary>
[Collection(nameof(MentionsCollection))]
public sealed class MentionMcpTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task An_llm_mentions_by_email_and_reads_the_mentions_back()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Over MCP");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Owner));

        // Act
        var comment = await CallAsync(mcp, "add_comment", new() { ["key"] = "WEB-1", ["body"] = $"Please review, @{world.Viewer.Email}" });
        await CallAsync(mcp, "update_ticket", new() { ["key"] = "WEB-1", ["description"] = $"Owner: @{world.Member.Email}" });
        var ticket = await CallAsync(mcp, "get_ticket", new() { ["key"] = "WEB-1" });
        var comments = await CallAsync(mcp, "list_comments", new() { ["key"] = "WEB-1" });
        var people = await CallAsync(mcp, "find_users", new() { ["projectKey"] = "WEB", ["access"] = "Read", ["query"] = "vie" });

        // Assert
        Assert.Equal($"Please review, {world.Viewer.Mention()}", comment.GetProperty("body").GetString());
        Assert.Equal(world.Member.Id, ticket.GetProperty("mentions")[0].GetProperty("id").GetGuid());
        Assert.Equal($"Owner: {world.Member.Mention()}", ticket.GetProperty("description").GetString());
        Assert.Equal(world.Viewer.Id, comments.GetProperty("items")[0].GetProperty("mentions")[0].GetProperty("id").GetGuid());
        Assert.Equal(world.Viewer.Id, Assert.Single(people.GetProperty("items").EnumerateArray()).GetProperty("id").GetGuid());
        Assert.Equal(NotificationKind.Mentioned, Assert.Single(await api.StoredNotificationsAsync(world.Viewer)).Kind);
        Assert.Equal(NotificationKind.Mentioned, Assert.Single(await api.StoredNotificationsAsync(world.Member)).Kind);
    }

    [Fact]
    public async Task An_invalid_mention_is_a_tool_error_with_code_and_hint()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var outsider = await api.CreateUserAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Rejected");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Owner));

        // Act
        var result = await mcp.CallToolAsync(
            "add_comment", new Dictionary<string, object?> { ["key"] = "WEB-1", ["body"] = $"@{outsider.Email}" }, cancellationToken: _ct);

        // Assert
        Assert.True(result.IsError);
        var error = JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
        Assert.Equal(CollaborationErrors.MentionInvalid, error.GetProperty("code").GetString());
        Assert.Equal("Only active users who can read project WEB can be mentioned.", error.GetProperty("hint").GetString());
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        Assert.False(result.IsError == true, $"{tool} failed: {(result.Content.FirstOrDefault() as TextContentBlock)?.Text}");
        return JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }
}
