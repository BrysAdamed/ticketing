using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

[Collection(nameof(DocsCollection))]
public sealed class DocMcpTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task An_llm_builds_and_edits_docs_through_the_doc_tools()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await (await api.LoginAsync(user)).CreateProjectAsync("LLM");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));

        // Act
        var folder = await CallAsync(mcp, "create_folder", new() { ["projectKey"] = "LLM", ["title"] = "Architecture" });
        var page = await CallAsync(mcp, "create_page", new()
        {
            ["projectKey"] = "LLM", ["title"] = "Overview", ["parent"] = "architecture", ["content"] = "# Overview\n\nUses Postgres.", ["changeNote"] = "First draft",
        });
        var byPath = await CallAsync(mcp, "get_doc", new() { ["projectKey"] = "llm", ["path"] = "Architecture/overview" });
        var updated = await CallAsync(mcp, "update_doc", new() { ["docKey"] = "LLM-D-2", ["content"] = "# Overview\n\nUses PostgreSQL 18.", ["baseVersion"] = 1 });
        var stale = await mcp.CallToolAsync("update_doc", new Dictionary<string, object?> { ["docKey"] = "LLM-D-2", ["content"] = "x", ["baseVersion"] = 1 }, cancellationToken: _ct);
        var edited = await CallAsync(mcp, "edit_doc", new()
        {
            ["docKey"] = "LLM-D-2", ["edits"] = new[] { new { oldText = "PostgreSQL 18", newText = "PostgreSQL 18 and EF Core" } },
        });
        var noMatch = await mcp.CallToolAsync("edit_doc", new Dictionary<string, object?>
        {
            ["docKey"] = "LLM-D-2", ["edits"] = new[] { new { oldText = "MySQL", newText = "x" } },
        }, cancellationToken: _ct);
        var moved = await CallAsync(mcp, "move_doc", new() { ["docKey"] = "LLM-D-2", ["parent"] = "root", ["position"] = "Top" });
        var list = await CallAsync(mcp, "list_docs", new() { ["projectKey"] = "LLM" });
        var deleted = await CallAsync(mcp, "delete_doc", new() { ["docKey"] = folder.GetProperty("key").GetString() });

        // Assert
        Assert.Equal(("LLM-D-1", "Folder"), (folder.GetProperty("key").GetString(), folder.GetProperty("kind").GetString()));
        Assert.Equal(("Architecture/Overview", 1), (page.GetProperty("path").GetString(), page.GetProperty("version").GetInt32()));
        Assert.Equal("# Overview\n\nUses Postgres.", byPath.GetProperty("content").GetString());
        Assert.Equal(2, updated.GetProperty("version").GetInt32());
        var conflict = Error(stale);
        Assert.Equal((DocErrors.VersionConflict, 2), (conflict.GetProperty("code").GetString(), conflict.GetProperty("currentVersion").GetInt32()));
        Assert.Equal(user.Email, conflict.GetProperty("updatedBy").GetProperty("email").GetString());
        Assert.Equal((3, "# Overview\n\nUses PostgreSQL 18 and EF Core."), (edited.GetProperty("version").GetInt32(), edited.GetProperty("content").GetString()));
        Assert.Equal(DocErrors.EditNoMatch, Error(noMatch).GetProperty("code").GetString());
        Assert.Equal("Overview", moved.GetProperty("path").GetString());
        Assert.Equal(["Overview", "Architecture"], list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()));
        Assert.Equal(1, deleted.GetProperty("deletedCount").GetInt32());
        var channels = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.EntityType == ActivityEntityType.Doc).Select(a => a.Channel).Distinct().ToListAsync(_ct));
        Assert.Equal([WriteChannel.Mcp], channels);
        var versionChannels = await api.WithDbAsync(db => db.DocVersions.Select(v => v.Channel).Distinct().ToListAsync(_ct));
        Assert.Equal([WriteChannel.Mcp], versionChannels);
    }

    [Fact]
    public async Task Read_only_tokens_see_only_the_read_doc_tools()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await using var readOnly = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));
        await using var readWrite = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadWrite));
        string[] docTools =
        [
            "list_docs", "get_doc", "get_doc_history", "list_doc_attachments", "create_folder", "create_page", "update_doc", "edit_doc",
            "restore_doc_version", "move_doc", "delete_doc",
        ];

        // Act
        var readOnlyTools = (await readOnly.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).Intersect(docTools).Order().ToList();
        var readWriteTools = (await readWrite.ListToolsAsync(cancellationToken: _ct)).Where(t => docTools.Contains(t.Name)).ToList();

        // Assert
        Assert.Equal(new[] { "get_doc", "get_doc_history", "list_doc_attachments", "list_docs" }.Order(), readOnlyTools);
        Assert.Equal(docTools.Order(), readWriteTools.Select(t => t.Name).Order());
        Assert.True(readWriteTools.Single(t => t.Name == "delete_doc").ProtocolTool.Annotations?.DestructiveHint);
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        var payload = JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
        Assert.True(result.IsError != true, $"{tool} failed: {payload}");
        return payload;
    }

    private static JsonElement Error(CallToolResult result)
    {
        Assert.True(result.IsError);
        return JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }
}
