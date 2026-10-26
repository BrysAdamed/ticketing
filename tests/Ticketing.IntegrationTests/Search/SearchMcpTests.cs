using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Search;

[Collection(nameof(SearchCollection))]
public sealed class SearchMcpTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Search_tickets_applies_filters_sort_and_paging_like_rest()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", me);
        await api.SeedTicketsAsync(web, me.Id,
            new SeedTicket("Crash", TicketType.Bug) { Severity = Severity.Critical, AssigneeId = me.Id },
            new SeedTicket("Minor glitch", TicketType.Bug),
            new SeedTicket("Story"),
            new SeedTicket("Done bug", TicketType.Bug) { Status = TicketStatus.Done });
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(me, PatScope.ReadOnly));

        // Act
        var openBugs = await CallAsync(mcp, "search_tickets", new()
        {
            ["projectKeys"] = new[] { "web" }, ["types"] = new[] { "Bug" }, ["statusCategory"] = new[] { "ToDo", "InProgress" },
            ["sort"] = "Key", ["order"] = "Desc", ["limit"] = 1,
        });
        var next = await CallAsync(mcp, "search_tickets", new()
        {
            ["projectKeys"] = new[] { "web" }, ["types"] = new[] { "Bug" }, ["statusCategory"] = new[] { "ToDo", "InProgress" },
            ["sort"] = "Key", ["order"] = "Desc", ["limit"] = 1, ["cursor"] = openBugs.GetProperty("nextCursor").GetString(),
        });
        var mine = await CallAsync(mcp, "search_tickets", new() { ["assignee"] = new[] { "me" }, ["severities"] = new[] { "Critical", "none" } });
        var invalid = await mcp.CallToolAsync("search_tickets", new Dictionary<string, object?> { ["createdFrom"] = "last week" }, cancellationToken: _ct);

        // Assert
        Assert.Equal(2, openBugs.GetProperty("total").GetInt32());
        Assert.Equal("WEB-2", openBugs.GetProperty("items")[0].GetProperty("key").GetString());
        Assert.Equal("WEB-1", next.GetProperty("items")[0].GetProperty("key").GetString());
        Assert.Equal(["WEB-1"], mine.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("key").GetString()));
        Assert.True(invalid.IsError);
        Assert.Equal("validation", Payload(invalid).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Search_tickets_never_returns_private_projects_of_others()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var priv = await api.SeedProjectAsync("PRIV", owner, ProjectVisibility.Private);
        var pub = await api.SeedProjectAsync("PUB", owner, ProjectVisibility.Public);
        await api.SeedTicketsAsync(priv, owner.Id, new SeedTicket("Secret"));
        await api.SeedTicketsAsync(pub, owner.Id, new SeedTicket("Public"));
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(outsider));

        // Act
        var all = await CallAsync(mcp, "search_tickets", new());
        var targeted = await CallAsync(mcp, "search_tickets", new() { ["projectKeys"] = new[] { "PRIV" }, ["text"] = "secret" });

        // Assert
        Assert.Equal(["PUB-1"], all.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("key").GetString()));
        Assert.Empty(targeted.GetProperty("items").EnumerateArray());
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
