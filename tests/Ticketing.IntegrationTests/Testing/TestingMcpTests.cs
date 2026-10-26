using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Testing;

[Collection(nameof(TestingCollection))]
public sealed class TestingMcpTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Test_case_tools_create_list_get_and_update()
    {
        // Arrange
        var (mcp, _) = await SetUpAsync();
        await using var session = mcp;

        // Act
        var created = await CallAsync(mcp, "create_test_case", new()
        {
            ["projectKey"] = "WEB", ["title"] = "Login", ["steps"] = new[] { "Open", "Submit" }, ["status"] = "Manual", ["ticketKey"] = "WEB-1",
        });
        await CallAsync(mcp, "create_test_case", new() { ["projectKey"] = "WEB", ["title"] = "Draft" });
        var listed = await CallAsync(mcp, "list_test_cases", new() { ["projectKey"] = "WEB", ["statuses"] = new[] { "Manual" } });
        var updated = await CallAsync(mcp, "update_test_case", new()
        {
            ["key"] = "web-tc-1", ["steps"] = new[] { "Only step" }, ["ticketKey"] = null, ["expectedVersion"] = created.GetProperty("rowVersion").GetUInt32(),
        });
        var archived = await CallAsync(mcp, "update_test_case", new() { ["key"] = "WEB-TC-2", ["archived"] = true });
        var fetched = await CallAsync(mcp, "get_test_case", new() { ["key"] = "WEB-TC-1" });

        // Assert
        Assert.Equal(("WEB-TC-1", "WEB-1"), (created.GetProperty("key").GetString(), created.GetProperty("ticket").GetProperty("key").GetString()));
        Assert.Equal(["WEB-TC-1"], listed.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("key").GetString()));
        Assert.Equal(1, listed.GetProperty("counts").GetProperty("new").GetInt32());
        Assert.Equal(["Only step"], updated.GetProperty("steps").EnumerateArray().Select(s => s.GetString()));
        Assert.False(updated.TryGetProperty("ticket", out _));
        Assert.True(archived.TryGetProperty("archivedAt", out _));
        Assert.Equal("Login", fetched.GetProperty("title").GetString());
        var channels = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.EntityType == ActivityEntityType.TestCase).Select(a => a.Channel).Distinct().ToListAsync(_ct));
        Assert.Equal([WriteChannel.Mcp], channels);
    }

    [Fact]
    public async Task Regression_tools_run_a_whole_session()
    {
        // Arrange
        var (mcp, user) = await SetUpAsync();
        await using var session = mcp;
        await CallAsync(mcp, "create_test_case", new() { ["projectKey"] = "WEB", ["title"] = "Login", ["steps"] = new[] { "Open" }, ["status"] = "Manual" });
        await CallAsync(mcp, "create_test_case", new() { ["projectKey"] = "WEB", ["title"] = "Export", ["steps"] = new[] { "Click" }, ["status"] = "Manual" });
        await CallAsync(mcp, "create_test_case", new() { ["projectKey"] = "WEB", ["title"] = "API", ["status"] = "Automatic" });

        // Act
        var started = await CallAsync(mcp, "start_regression_session", new() { ["projectKey"] = "WEB", ["version"] = "2.0" });
        var taken = await CallAsync(mcp, "take_regression_item", new() { ["sessionKey"] = "WEB-R-1", ["testCaseKey"] = "WEB-TC-1" });
        var assigned = await CallAsync(mcp, "assign_regression_item", new() { ["sessionKey"] = "WEB-R-1", ["testCaseKey"] = "WEB-TC-2", ["assignee"] = user.Email });
        var failed = await CallAsync(mcp, "record_regression_result", new()
        {
            ["sessionKey"] = "WEB-R-1", ["testCaseKey"] = "WEB-TC-1", ["status"] = "Failed", ["note"] = "Error 500",
        });
        var missingNote = await mcp.CallToolAsync("record_regression_result", new Dictionary<string, object?>
        {
            ["sessionKey"] = "WEB-R-1", ["testCaseKey"] = "WEB-TC-2", ["status"] = "Failed",
        }, cancellationToken: _ct);
        var mine = await CallAsync(mcp, "get_regression_session", new() { ["sessionKey"] = "web-r-1", ["assignee"] = "me", ["itemStatus"] = "Failed" });
        var completed = await CallAsync(mcp, "complete_regression_session", new() { ["sessionKey"] = "WEB-R-1", ["skipRemaining"] = true });
        await CallAsync(mcp, "start_regression_session", new() { ["projectKey"] = "WEB" });
        var cancelled = await CallAsync(mcp, "cancel_regression_session", new() { ["sessionKey"] = "WEB-R-2" });
        var listed = await CallAsync(mcp, "list_regression_sessions", new() { ["projectKey"] = "WEB", ["status"] = "Completed" });

        // Assert
        Assert.Equal(("WEB-R-1", 3), (started.GetProperty("key").GetString(), started.GetProperty("items").GetArrayLength()));
        Assert.Equal(user.Email, taken.GetProperty("item").GetProperty("assignee").GetProperty("email").GetString());
        Assert.Equal(user.Email, assigned.GetProperty("item").GetProperty("assignee").GetProperty("email").GetString());
        Assert.Equal(nameof(RegressionItemStatus.Failed), failed.GetProperty("item").GetProperty("status").GetString());
        Assert.True(missingNote.IsError);
        Assert.Equal(RegressionErrors.NoteRequired, Payload(missingNote).GetProperty("code").GetString());
        Assert.Equal(["WEB-TC-1"], mine.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("testCaseKey").GetString()));
        Assert.Equal(("Completed", 1, 1), (completed.GetProperty("status").GetString(),
            completed.GetProperty("summary").GetProperty("skipped").GetInt32(), completed.GetProperty("summary").GetProperty("passedAutomatic").GetInt32()));
        Assert.Equal("Cancelled", cancelled.GetProperty("status").GetString());
        Assert.Equal(["WEB-R-1"], listed.GetProperty("items").EnumerateArray().Select(s => s.GetProperty("key").GetString()));
    }

    [Fact]
    public async Task Read_only_tokens_see_only_read_tools_and_cancel_is_destructive()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await using var readOnly = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));
        await using var readWrite = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadWrite));

        // Act
        var readTools = (await readOnly.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).ToHashSet();
        var allTools = await readWrite.ListToolsAsync(cancellationToken: _ct);

        // Assert
        Assert.Superset(new HashSet<string> { "list_test_cases", "get_test_case", "list_regression_sessions", "get_regression_session" }, readTools);
        Assert.DoesNotContain("record_regression_result", readTools);
        Assert.DoesNotContain("create_test_case", readTools);
        Assert.Superset(
            new HashSet<string>
            {
                "create_test_case", "update_test_case", "start_regression_session", "take_regression_item", "assign_regression_item",
                "record_regression_result", "complete_regression_session", "cancel_regression_session",
            },
            allTools.Select(t => t.Name).ToHashSet());
        Assert.True(allTools.Single(t => t.Name == "cancel_regression_session").ProtocolTool.Annotations?.DestructiveHint);
    }

    [Fact]
    public async Task Private_projects_are_not_found_through_the_tools()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        await ownerClient.CreateProjectAsync("PRIV");
        await ownerClient.CreateManualCaseAsync("PRIV", "Secret");
        await ownerClient.StartSessionAsync("PRIV");
        var outsider = await api.CreateUserAsync();
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(outsider));

        // Act
        var list = await mcp.CallToolAsync("list_test_cases", new Dictionary<string, object?> { ["projectKey"] = "PRIV" }, cancellationToken: _ct);
        var get = await mcp.CallToolAsync("get_test_case", new Dictionary<string, object?> { ["key"] = "PRIV-TC-1" }, cancellationToken: _ct);
        var sessions = await mcp.CallToolAsync("list_regression_sessions", new Dictionary<string, object?> { ["projectKey"] = "PRIV" }, cancellationToken: _ct);
        var session = await mcp.CallToolAsync("get_regression_session", new Dictionary<string, object?> { ["sessionKey"] = "PRIV-R-1" }, cancellationToken: _ct);
        var take = await mcp.CallToolAsync("take_regression_item", new Dictionary<string, object?>
        {
            ["sessionKey"] = "PRIV-R-1", ["testCaseKey"] = "PRIV-TC-1",
        }, cancellationToken: _ct);

        // Assert
        Assert.Equal(ProjectErrors.NotFound, Payload(list).GetProperty("code").GetString());
        Assert.Equal(TestCaseErrors.NotFound, Payload(get).GetProperty("code").GetString());
        Assert.Equal(ProjectErrors.NotFound, Payload(sessions).GetProperty("code").GetString());
        Assert.Equal(RegressionErrors.NotFound, Payload(session).GetProperty("code").GetString());
        Assert.Equal(RegressionErrors.NotFound, Payload(take).GetProperty("code").GetString());
    }

    private async Task<(McpClient Mcp, TestUser User)> SetUpAsync()
    {
        var user = await api.CreateUserAsync();
        var project = await (await api.LoginAsync(user)).CreateProjectAsync("WEB");
        await api.CreateTicketAsync(project, 1);
        return (await api.CreateMcpClientAsync(await api.CreatePatAsync(user)), user);
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        if (result.IsError == true)
            Assert.Fail($"{tool} failed: {Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text}");
        return Payload(result);
    }

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
}
