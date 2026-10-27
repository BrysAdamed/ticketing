using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
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
    public async Task An_llm_creates_and_edits_a_mermaid_diagram()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await (await api.LoginAsync(user)).CreateProjectAsync("MMD");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));
        const string flowchart = "flowchart LR\r\n  API --> DB\r\n  API --> Cache";

        // Act
        var created = await CallAsync(mcp, "create_diagram", new() { ["projectKey"] = "MMD", ["title"] = "Data flow", ["source"] = flowchart });
        var read = await CallAsync(mcp, "get_doc", new() { ["docKey"] = "MMD-D-1" });
        var edited = await CallAsync(mcp, "edit_doc", new()
        {
            ["docKey"] = "MMD-D-1", ["edits"] = new[] { new { oldText = "API --> Cache", newText = "API --> Queue" } },
        });
        var replaced = await CallAsync(mcp, "update_doc", new() { ["docKey"] = "MMD-D-1", ["content"] = "sequenceDiagram\n  A->>B: hi", ["baseVersion"] = 2 });
        var blank = await CallAsync(mcp, "create_diagram", new() { ["projectKey"] = "MMD", ["title"] = "Later", ["format"] = "Mermaid" });
        var tooLong = await mcp.CallToolAsync("create_diagram", new Dictionary<string, object?>
        {
            ["projectKey"] = "MMD", ["title"] = "Huge", ["source"] = new string('x', DocNode.MermaidSourceMaxLength + 1),
        }, cancellationToken: _ct);

        // Assert
        Assert.Equal(("Diagram", "Mermaid", 1), (created.GetProperty("kind").GetString(), created.GetProperty("diagramFormat").GetString(), created.GetProperty("version").GetInt32()));
        Assert.Equal("flowchart LR\n  API --> DB\n  API --> Cache", read.GetProperty("content").GetString());
        Assert.Equal((2, "flowchart LR\n  API --> DB\n  API --> Queue"), (edited.GetProperty("version").GetInt32(), edited.GetProperty("content").GetString()));
        Assert.Equal((3, "sequenceDiagram\n  A->>B: hi"), (replaced.GetProperty("version").GetInt32(), replaced.GetProperty("content").GetString()));
        Assert.Equal(("Mermaid", ""), (blank.GetProperty("diagramFormat").GetString(), blank.GetProperty("content").GetString()));
        Assert.Equal(DocErrors.ContentTooLong, Error(tooLong).GetProperty("code").GetString());
        var nodeId = created.GetProperty("id").GetGuid();
        var channels = await api.WithDbAsync(db => db.DocVersions.Where(v => v.NodeId == nodeId).Select(v => v.Channel).Distinct().ToListAsync(_ct));
        Assert.Equal([WriteChannel.Mcp], channels);
    }

    [Fact]
    public async Task Create_diagram_lists_the_supported_mermaid_types_and_respects_project_access()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var project = await ownerClient.CreateProjectAsync("MMDP");
        await ownerClient.CreateProjectAsync("MMDS");
        var viewer = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewer, ProjectRole.Viewer);
        await using var viewerMcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(viewer));

        // Act
        var tools = await viewerMcp.ListToolsAsync(cancellationToken: _ct);
        var asViewer = await viewerMcp.CallToolAsync("create_diagram", new Dictionary<string, object?> { ["projectKey"] = "MMDP", ["title"] = "x" }, cancellationToken: _ct);
        var privateProject = await viewerMcp.CallToolAsync("create_diagram", new Dictionary<string, object?> { ["projectKey"] = "MMDS", ["title"] = "x" }, cancellationToken: _ct);
        var missingProject = await viewerMcp.CallToolAsync("create_diagram", new Dictionary<string, object?> { ["projectKey"] = "NOPE", ["title"] = "x" }, cancellationToken: _ct);

        // Assert
        var description = tools.Single(t => t.Name == "create_diagram").Description;
        foreach (var type in new[] { "flowchart", "sequenceDiagram", "classDiagram", "stateDiagram-v2", "erDiagram", "gantt", "mindmap" })
        {
            Assert.Contains(type, description, StringComparison.Ordinal);
            Assert.Contains(type, tools.Single(t => t.Name == "update_doc").Description, StringComparison.Ordinal);
        }
        Assert.Equal("project.forbidden", Error(asViewer).GetProperty("code").GetString());
        Assert.Equal(Error(missingProject).GetProperty("code").GetString(), Error(privateProject).GetProperty("code").GetString());
        Assert.Equal(0, await api.WithDbAsync(db => db.DocNodes.CountAsync(n => n.ProjectId == project.Id, _ct)));
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
            "list_docs", "get_doc", "get_doc_history", "list_doc_attachments", "create_folder", "create_page", "create_diagram", "update_doc",
            "edit_doc", "restore_doc_version", "move_doc", "delete_doc",
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
