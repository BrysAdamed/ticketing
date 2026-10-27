using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Boards;

[Collection(nameof(BoardsCollection))]
public sealed class BoardMcpTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Create_update_list_and_get_board_through_mcp()
    {
        // Arrange
        var (mcp, _, browser) = await SetUpAsync();
        await using var session = mcp;
        await browser.CreateProjectAsync("API");
        await browser.CreateTicketAsync("WEB", "Assigned", extra: new { assignee = "me" });

        // Act
        var created = await CallAsync(mcp, "create_board", new() { ["name"] = "Sprint", ["projectKeys"] = new[] { "WEB" } });
        var boardId = created.GetProperty("id").GetString()!;
        var updated = await CallAsync(mcp, "update_board", new() { ["boardId"] = boardId, ["name"] = "Sprint 7", ["addProjectKeys"] = new[] { "API" } });
        await CallAsync(mcp, "move_ticket", new() { ["keys"] = new[] { "WEB-1" }, ["target"] = boardId, ["status"] = "Review" });
        var listed = await CallAsync(mcp, "list_boards", new() { ["projectKey"] = "API" });
        var fetched = await CallAsync(mcp, "get_board", new() { ["boardId"] = boardId, ["statuses"] = new[] { "Review" } });

        // Assert
        Assert.Equal(8, created.GetProperty("columns").GetArrayLength());
        Assert.Equal("Sprint 7", updated.GetProperty("name").GetString());
        var row = Assert.Single(listed.GetProperty("items").EnumerateArray());
        Assert.Equal(1, row.GetProperty("counts").GetProperty("inProgress").GetInt32());
        var column = Assert.Single(fetched.GetProperty("columns").EnumerateArray());
        Assert.Equal(("Review", 1), (column.GetProperty("status").GetString(), column.GetProperty("count").GetInt32()));
        var card = Assert.Single(column.GetProperty("tickets").EnumerateArray());
        Assert.Equal("WEB-1", card.GetProperty("key").GetString());
        Assert.False(string.IsNullOrEmpty(card.GetProperty("assignee").GetProperty("email").GetString()));
    }

    [Fact]
    public async Task Move_ticket_places_reorders_and_sends_back_to_the_backlog()
    {
        // Arrange
        var (mcp, _, browser) = await SetUpAsync();
        await using var session = mcp;
        var board = await browser.CreateBoardAsync("Sprint", "WEB");
        for (var i = 1; i <= 3; i++)
            await browser.CreateTicketAsync("WEB", $"Ticket {i}");

        // Act
        var placed = await CallAsync(mcp, "move_ticket", new() { ["keys"] = new[] { "WEB-1", "WEB-2" }, ["target"] = board.Id.ToString() });
        await CallAsync(mcp, "move_ticket", new() { ["keys"] = new[] { "WEB-2" }, ["target"] = board.Id.ToString(), ["beforeKey"] = "WEB-1" });
        var back = await CallAsync(mcp, "move_ticket", new() { ["keys"] = new[] { "WEB-1" }, ["target"] = "backlog", ["afterKey"] = "WEB-3" });
        var error = await mcp.CallToolAsync("move_ticket", new Dictionary<string, object?> { ["keys"] = new[] { "WEB-3" }, ["target"] = Guid.NewGuid().ToString() }, cancellationToken: _ct);

        // Assert
        Assert.All(placed.EnumerateArray(), t => Assert.Equal("Board", t.GetProperty("location").GetProperty("kind").GetString()));
        Assert.Equal("Backlog", back[0].GetProperty("location").GetProperty("kind").GetString());
        Assert.Equal(["ToDo: WEB-2"], (await browser.GetBoardAsync(board.Id)).Layout());
        Assert.True(error.IsError);
        Assert.Contains(BoardErrors.NotFound, Assert.IsType<TextContentBlock>(Assert.Single(error.Content)).Text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Move_ticket_with_include_children_and_get_move_children_match_rest()
    {
        // Arrange
        var (mcp, _, browser) = await SetUpAsync();
        await using var session = mcp;
        var board = await browser.CreateBoardAsync("Sprint", "WEB");
        await browser.CreateTicketAsync("WEB", "Epic", "Epic");
        await browser.CreateTicketAsync("WEB", "Story", extra: new { parentKey = "WEB-1" });
        await browser.CreateTicketAsync("WEB", "Task", "Technical", new { parentKey = "WEB-2" });
        await browser.CreateTicketAsync("WEB", "Finished", "Technical", new { parentKey = "WEB-2", status = "Done" });
        var rest = await browser.PreviewAsync(["WEB-1"]);

        // Act
        var preview = await CallAsync(mcp, "get_move_children", new() { ["keys"] = new[] { "WEB-1" } });
        var moved = await CallAsync(mcp, "move_ticket", new() { ["keys"] = new[] { "WEB-1" }, ["target"] = board.Id.ToString(), ["includeChildren"] = true });

        // Assert
        Assert.Equal((rest.Count, rest.Done), (preview.GetProperty("count").GetInt32(), preview.GetProperty("done").GetInt32()));
        var children = Assert.Single(preview.GetProperty("parents").EnumerateArray()).GetProperty("children").EnumerateArray();
        Assert.Equal(rest.Parents[0].Children.Select(c => c.Key), children.Select(c => c.GetProperty("key").GetString()));
        Assert.Equal(["WEB-1", "WEB-2", "WEB-3"], moved.EnumerateArray().Select(t => t.GetProperty("key").GetString()));
        Assert.Equal(["ToDo: WEB-1, WEB-2, WEB-3"], (await browser.GetBoardAsync(board.Id)).Layout());
    }

    [Fact]
    public async Task Archive_board_reports_where_tickets_went_and_read_only_tokens_cannot_see_write_tools()
    {
        // Arrange
        var (mcp, user, browser) = await SetUpAsync();
        await using var session = mcp;
        var board = await browser.CreateBoardAsync("Sprint", "WEB");
        var open = await browser.CreateTicketAsync("WEB", "Open");
        var done = await browser.CreateTicketAsync("WEB", "Done", extra: new { status = "Done" });
        await browser.MoveOkAsync(board.Id.ToString(), [open.Key, done.Key]);
        await using var readOnly = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));

        // Act
        var archived = await CallAsync(mcp, "archive_board", new() { ["boardId"] = board.Id.ToString(), ["carryOverTo"] = "backlog" });
        var readOnlyTools = (await readOnly.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).ToList();
        var allTools = await mcp.ListToolsAsync(cancellationToken: _ct);

        // Assert
        Assert.Equal((1, 1, 0), (archived.GetProperty("movedToBacklog").GetInt32(), archived.GetProperty("stayedDone").GetInt32(), archived.GetProperty("movedToBoard").GetInt32()));
        Assert.False(string.IsNullOrEmpty(archived.GetProperty("board").GetProperty("archivedAt").GetString()));
        Assert.Contains("list_boards", readOnlyTools);
        Assert.Contains("get_board", readOnlyTools);
        Assert.DoesNotContain("archive_board", readOnlyTools);
        Assert.DoesNotContain("move_ticket", readOnlyTools);
        Assert.True(allTools.Single(t => t.Name == "archive_board").ProtocolTool.Annotations?.DestructiveHint);
        Assert.True(allTools.Single(t => t.Name == "get_board").ProtocolTool.Annotations?.ReadOnlyHint);
    }

    [Fact]
    public async Task Get_board_through_mcp_omits_cards_of_unreadable_projects()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var browser = await api.LoginAsync(owner);
        await browser.CreateProjectAsync("SEC");
        await browser.CreateProjectAsync("PUB", ProjectVisibility.Public);
        var board = await browser.CreateBoardAsync("Shared", "SEC", "PUB");
        var secret = await browser.CreateTicketAsync("SEC", "Secret");
        var visible = await browser.CreateTicketAsync("PUB", "Visible");
        await browser.MoveOkAsync(board.Id.ToString(), [secret.Key, visible.Key]);
        var outsider = await api.CreateUserAsync();
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(outsider));

        // Act
        var fetched = await CallAsync(mcp, "get_board", new() { ["boardId"] = board.Id.ToString() });
        var listed = await CallAsync(mcp, "list_boards", new());

        // Assert
        var keys = fetched.GetProperty("columns").EnumerateArray().SelectMany(c => c.GetProperty("tickets").EnumerateArray()).Select(t => t.GetProperty("key").GetString());
        Assert.Equal(["PUB-1"], keys);
        Assert.Equal(["PUB"], fetched.GetProperty("projects").EnumerateArray().Select(p => p.GetProperty("key").GetString()));
        Assert.Equal(1, Assert.Single(listed.GetProperty("items").EnumerateArray()).GetProperty("counts").GetProperty("toDo").GetInt32());
    }

    private async Task<(McpClient Client, TestUser User, HttpClient Browser)> SetUpAsync()
    {
        var user = await api.CreateUserAsync();
        var browser = await api.LoginAsync(user);
        await browser.CreateProjectAsync("WEB");
        return (await api.CreateMcpClientAsync(await api.CreatePatAsync(user)), user, browser);
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        Assert.False(result.IsError == true, $"{tool} failed: {(result.Content.FirstOrDefault() as TextContentBlock)?.Text}");
        return JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }
}
