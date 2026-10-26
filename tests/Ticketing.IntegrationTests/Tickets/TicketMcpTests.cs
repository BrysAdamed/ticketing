using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Tickets;

[Collection(nameof(TicketsCollection))]
public sealed class TicketMcpTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Create_get_and_update_ticket_with_null_clearing_and_omitted_fields_kept()
    {
        // Arrange
        var (mcp, user) = await SetUpAsync();
        await using var session = mcp;

        // Act
        var created = await CallAsync(mcp, "create_ticket", new()
        {
            ["projectKey"] = "WEB", ["title"] = "From the model", ["type"] = "Bug", ["severity"] = "Major", ["assignee"] = user.Email,
            ["version"] = "1.0", ["labels"] = new[] { "llm" },
        });
        var updated = await CallAsync(mcp, "update_ticket", new()
        {
            ["key"] = "web-1", ["severity"] = null, ["assignee"] = null, ["status"] = "Done", ["resolution"] = "WontDo", ["addLabels"] = new[] { "triaged" },
        });
        var fetched = await CallAsync(mcp, "get_ticket", new() { ["key"] = "WEB-1", ["include"] = new[] { "comments" } });

        // Assert
        Assert.Equal("WEB-1", created.GetProperty("key").GetString());
        Assert.Equal(user.Email, created.GetProperty("assignee").GetProperty("email").GetString());
        Assert.False(updated.TryGetProperty("severity", out _));
        Assert.False(updated.TryGetProperty("assignee", out _));
        Assert.Equal(("1.0", "WontDo"), (updated.GetProperty("version").GetString(), updated.GetProperty("resolution").GetString()));
        Assert.Equal(["llm", "triaged"], updated.GetProperty("labels").EnumerateArray().Select(l => l.GetString()));
        Assert.Equal(0, fetched.GetProperty("commentCount").GetInt32());
        Assert.False(fetched.TryGetProperty("children", out _));
        var channels = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.EntityType == ActivityEntityType.Ticket).Select(a => a.Channel).Distinct().ToListAsync(_ct));
        Assert.Equal([WriteChannel.Mcp], channels);
    }

    [Fact]
    public async Task Create_tickets_resolves_batch_parents_and_is_all_or_nothing()
    {
        // Arrange
        var (mcp, _) = await SetUpAsync();
        await using var session = mcp;

        // Act
        var created = await CallAsync(mcp, "create_tickets", new()
        {
            ["projectKey"] = "WEB",
            ["tickets"] = new object[]
            {
                new { title = "Epic", type = "Epic" },
                new { title = "Story", type = "UserStory", parentKey = "#0" },
                new { title = "Task", type = "Technical", parentKey = "#1" },
            },
        });
        var failed = await mcp.CallToolAsync("create_tickets", new Dictionary<string, object?>
        {
            ["projectKey"] = "WEB",
            ["tickets"] = new object[]
            {
                new { title = "Fine", type = "Bug" },
                new { title = "Too deep", type = "Bug", parentKey = "WEB-3" },
            },
        }, cancellationToken: _ct);

        // Assert
        Assert.Equal(["WEB-1", "WEB-2", "WEB-3"], created.EnumerateArray().Select(t => t.GetProperty("key").GetString()));
        Assert.Equal([null, "WEB-1", "WEB-2"], created.EnumerateArray().Select(t => t.TryGetProperty("parentKey", out var p) ? p.GetString() : null));
        Assert.True(failed.IsError);
        var error = Payload(failed);
        Assert.Equal(TicketErrors.ParentDepth, error.GetProperty("code").GetString());
        Assert.StartsWith("Ticket #1:", error.GetProperty("message").GetString(), StringComparison.Ordinal);
        Assert.Equal(3, await api.WithDbAsync(db => db.Tickets.CountAsync(_ct)));
    }

    [Fact]
    public async Task Links_comments_history_hints_and_delete_tools_work_end_to_end()
    {
        // Arrange
        var (mcp, _) = await SetUpAsync();
        await using var session = mcp;
        await CallAsync(mcp, "create_ticket", new() { ["projectKey"] = "WEB", ["title"] = "A", ["type"] = "Bug", ["labels"] = new[] { "backend" } });
        await CallAsync(mcp, "create_ticket", new() { ["projectKey"] = "WEB", ["title"] = "B", ["type"] = "Bug" });

        // Act
        var link = await CallAsync(mcp, "link_tickets", new() { ["sourceKey"] = "WEB-1", ["targetKey"] = "WEB-2", ["type"] = "Blocks" });
        var unlink = await CallAsync(mcp, "unlink_tickets", new() { ["sourceKey"] = "WEB-1", ["targetKey"] = "WEB-2", ["type"] = "Blocks" });
        var comment = await CallAsync(mcp, "add_comment", new() { ["key"] = "WEB-1", ["body"] = "See WEB-2" });
        var commentId = comment.GetProperty("id").GetString();
        var edited = await CallAsync(mcp, "update_comment", new() { ["commentId"] = commentId, ["body"] = "See WEB-2 again" });
        var listed = await CallAsync(mcp, "list_comments", new() { ["key"] = "WEB-1" });
        var deletedComment = await CallAsync(mcp, "delete_comment", new() { ["commentId"] = commentId });
        var history = await CallAsync(mcp, "get_ticket_history", new() { ["key"] = "WEB-1", ["limit"] = 100 });
        var hints = await CallAsync(mcp, "get_field_hints", new() { ["projectKey"] = "WEB", ["field"] = "labels", ["prefix"] = "back" });
        var deleted = await CallAsync(mcp, "delete_ticket", new() { ["key"] = "WEB-2" });
        var missing = await mcp.CallToolAsync("get_ticket", new Dictionary<string, object?> { ["key"] = "WEB-2" }, cancellationToken: _ct);

        // Assert
        Assert.Equal("blocks", link.GetProperty("label").GetString());
        Assert.True(unlink.GetProperty("removed").GetBoolean());
        Assert.True(edited.TryGetProperty("editedAt", out _));
        Assert.Equal(1, listed.GetProperty("items").GetArrayLength());
        Assert.True(deletedComment.GetProperty("deleted").GetBoolean());
        var actions = history.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("action").GetString()).ToList();
        Assert.Contains("ticket.link.added", actions);
        Assert.Contains("comment.edited", actions);
        Assert.Equal(["backend"], hints.EnumerateArray().Select(h => h.GetString()));
        Assert.True(deleted.GetProperty("deleted").GetBoolean());
        Assert.True(missing.IsError);
        Assert.Equal(TicketErrors.Deleted, Payload(missing).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Read_only_tokens_see_only_read_ticket_tools_and_destructive_tools_are_marked()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await using var readOnly = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));
        await using var readWrite = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));

        // Act
        var readTools = (await readOnly.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).ToHashSet();
        var allTools = (await readWrite.ListToolsAsync(cancellationToken: _ct)).ToDictionary(t => t.Name);

        // Assert
        Assert.Superset(new HashSet<string> { "get_ticket", "get_ticket_history", "list_comments", "get_field_hints" }, readTools);
        Assert.DoesNotContain("create_ticket", readTools);
        Assert.DoesNotContain("delete_comment", readTools);
        foreach (var name in new[] { "delete_ticket", "delete_comment", "unlink_tickets" })
            Assert.True(allTools[name].ProtocolTool.Annotations?.DestructiveHint);
        Assert.Contains("ReadyForTesting", allTools["update_ticket"].ProtocolTool.InputSchema.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Private_tickets_do_not_leak_through_mcp_reads()
    {
        // Arrange
        var (mcp, _) = await SetUpAsync();
        await using var session = mcp;
        await CallAsync(mcp, "create_ticket", new() { ["projectKey"] = "WEB", ["title"] = "Secret", ["type"] = "Bug", ["labels"] = new[] { "secret" } });
        await using var outsider = await api.CreateMcpClientAsync(await api.CreatePatAsync(await api.CreateUserAsync()));

        // Act
        var results = new List<CallToolResult>();
        foreach (var (tool, args) in new (string, Dictionary<string, object?>)[]
                 {
                     ("get_ticket", new() { ["key"] = "WEB-1" }),
                     ("get_ticket_history", new() { ["key"] = "WEB-1" }),
                     ("list_comments", new() { ["key"] = "WEB-1" }),
                     ("get_field_hints", new() { ["projectKey"] = "WEB", ["field"] = "labels" }),
                     ("add_comment", new() { ["key"] = "WEB-1", ["body"] = "Hi" }),
                 })
            results.Add(await outsider.CallToolAsync(tool, args, cancellationToken: _ct));

        // Assert
        Assert.All(results, r => Assert.True(r.IsError));
        Assert.All(results, r => Assert.EndsWith("notFound", Payload(r).GetProperty("code").GetString(), StringComparison.Ordinal));
    }

    private async Task<(McpClient Client, TestUser User)> SetUpAsync()
    {
        var user = await api.CreateUserAsync();
        var browser = await api.LoginAsync(user);
        await browser.CreateProjectAsync("WEB");
        return (await api.CreateMcpClientAsync(await api.CreatePatAsync(user)), user);
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        Assert.False(result.IsError == true, $"{tool} failed: {(result.Content.FirstOrDefault() as TextContentBlock)?.Text}");
        return Payload(result);
    }

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
}
