using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Api.Endpoints;
using Ticketing.Application.Docs;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Canvas diagrams (TKT-18, spec 1.8, D-110): source rules, outline, the SVG picture per version and who may fill it.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocCanvasTests(TicketingApiFactory api)
{
    private const string Svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="120" height="60"><rect width="120" height="60" fill="#fff"/><text x="10" y="30">API</text></svg>""";
    private const string OtherSvg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><rect width="10" height="10"/></svg>""";

    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    /// <summary>A scene with two labelled boxes and a bound arrow API → DB, as the editor saves it.</summary>
    public static string ApiToDb(string extraLabel = "")
    {
        var note = extraLabel.Length == 0
            ? ""
            : $$""",{"id":"note","type":"text","x":0,"y":200,"isDeleted":false,"text":"{{extraLabel}}","originalText":"{{extraLabel}}"}""";
        return $$$"""
        {"type":"excalidraw","version":2,"source":"https://ticketing.local","elements":[
          {"id":"api","type":"rectangle","x":0,"y":0,"width":120,"height":60,"isDeleted":false,"boundElements":[{"id":"api-t","type":"text"},{"id":"arrow","type":"arrow"}]},
          {"id":"api-t","type":"text","x":40,"y":20,"isDeleted":false,"containerId":"api","text":"API","originalText":"API"},
          {"id":"db","type":"rectangle","x":300,"y":0,"width":120,"height":60,"isDeleted":false,"link":"https://example.com/db"},
          {"id":"db-t","type":"text","x":340,"y":20,"isDeleted":false,"containerId":"db","text":"DB","originalText":"DB"},
          {"id":"arrow","type":"arrow","x":120,"y":30,"isDeleted":false,"startBinding":{"elementId":"api"},"endBinding":{"elementId":"db"},"startArrowhead":null,"endArrowhead":"arrow"}
          {{{note}}}
        ],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}
        """;
    }

    [Fact]
    public async Task Publishing_a_canvas_stores_its_outline_and_picture_and_makes_its_labels_searchable()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("CNV");

        // Act
        var created = await client.CreateDocAsync("CNV", new { kind = "Diagram", diagramFormat = "Canvas", title = "Architecture", content = ApiToDb(), snapshot = Svg });
        var picture = await client.GetAsync(created.SnapshotUrl, _ct);
        var updated = await (await client.PatchDocAsync(created.Key, new { content = ApiToDb("Gotenberg sidecar"), baseVersion = 1 })).ReadAsync<DocDto>();
        var found = await client.SearchDocKeysAsync("q=gotenberg&project=CNV");
        var first = await client.GetDocAsync($"{created.Key}?version=1");
        var version1 = await (await client.GetAsync($"/api/v1/docs/{created.Key}/versions/1", _ct)).ReadAsync<DocVersionDto>();

        // Assert
        Assert.Equal("API\nDB\nAPI → DB", created.Outline);
        Assert.Equal($"/api/v1/docs/{created.Key}/versions/1/snapshot.svg", created.SnapshotUrl);
        Assert.Equal(HttpStatusCode.OK, picture.StatusCode);
        Assert.Equal(CanvasSnapshot.ContentType, picture.Content.Headers.ContentType?.MediaType);
        Assert.Equal(DocEndpoints.SnapshotSecurityPolicy, picture.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal("nosniff", picture.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal(Svg, await picture.Content.ReadAsStringAsync(_ct));
        Assert.Equal((2, "API\nDB\nGotenberg sidecar\nAPI → DB", null), (updated.Version, updated.Outline, updated.SnapshotUrl));
        Assert.Equal([created.Key], found);
        Assert.Equal(("API\nDB\nAPI → DB", created.SnapshotUrl), (first.Outline, first.SnapshotUrl));
        Assert.Equal(created.SnapshotUrl, version1.SnapshotUrl);
    }

    [Fact]
    public async Task Sources_that_break_the_canvas_rules_and_bad_pictures_are_rejected()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("CVR");
        var canvas = await client.CreateDocAsync("CVR", new { kind = "Diagram", diagramFormat = "Canvas", title = "Board" });
        var mermaid = await client.CreateDocAsync("CVR", new { kind = "Diagram", diagramFormat = "Mermaid", title = "Flow", content = "flowchart LR\n A-->B" });
        var tooMany = $$"""{"type":"excalidraw","elements":[{{string.Join(',', Enumerable.Repeat("""{"id":"x","type":"line"}""", CanvasSource.MaxElements + 1))}}]}""";

        // Act
        var notJson = await client.PatchDocAsync(canvas.Key, new { content = "{oops", baseVersion = 1 });
        var withFiles = await client.PatchDocAsync(canvas.Key, new { content = """{"type":"excalidraw","elements":[],"files":{"f":{"dataURL":"data:image/png;base64,AA"}}}""", baseVersion = 1 });
        var withImage = await client.PatchDocAsync(canvas.Key, new { content = """{"type":"excalidraw","elements":[{"id":"i","type":"image"}]}""", baseVersion = 1 });
        var badLink = await client.PatchDocAsync(canvas.Key, new { content = """{"type":"excalidraw","elements":[{"id":"r","type":"rectangle","link":"javascript:alert(1)"}]}""", baseVersion = 1 });
        var overLimit = await client.PatchDocAsync(canvas.Key, new { content = tooMany, baseVersion = 1 });
        var scriptPicture = await client.PatchDocAsync(canvas.Key, new { content = ApiToDb(), baseVersion = 1, snapshot = """<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>""" });
        var pictureAlone = await client.PatchDocAsync(canvas.Key, new { title = "Renamed", snapshot = Svg });
        var mermaidPicture = await client.PatchDocAsync(mermaid.Key, new { content = "flowchart LR\n A-->C", baseVersion = 1, snapshot = Svg });
        var mermaidStore = await client.PutAsJsonAsync($"/api/v1/docs/{mermaid.Key}/versions/1/snapshot", new { svg = Svg }, _ct);

        // Assert
        await notJson.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.DiagramInvalidSource);
        await withFiles.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.DiagramEmbeddedFiles);
        await withImage.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.DiagramEmbeddedFiles);
        await badLink.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.DiagramInvalidSource);
        await overLimit.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.DiagramTooManyElements);
        await scriptPicture.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.SnapshotInvalid);
        Assert.Equal(HttpStatusCode.BadRequest, pictureAlone.StatusCode);
        await mermaidPicture.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.KindUnsupported);
        await mermaidStore.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.KindUnsupported);
        var after = await client.GetDocAsync(canvas.Key);
        Assert.Equal((1, "Board", ""), (after.Version, after.Title, after.Outline));
    }

    [Fact]
    public async Task A_version_written_over_mcp_gets_its_picture_from_the_first_writer_who_opens_it()
    {
        // Arrange
        var ownerUser = await api.CreateUserAsync();
        var owner = await api.LoginAsync(ownerUser);
        var project = await owner.CreateProjectAsync("CMC");
        var viewerUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewerUser, ProjectRole.Viewer);
        var viewer = await api.LoginAsync(viewerUser);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(ownerUser));
        var created = await CallAsync(mcp, "create_diagram", new()
        {
            ["projectKey"] = "CMC", ["title"] = "Services", ["format"] = "Canvas", ["source"] = ApiToDb(),
        });
        var key = created.GetProperty("key").GetString()!;
        var page = await owner.CreatePageAsync("CMC", "Overview", content: $"![Services]({key})");

        // Act
        var beforeView = await owner.GetDocAsync(key);
        var beforeEmbed = (await owner.GetDocAsync(page.Key)).Embeds.Single();
        var missing = await viewer.GetAsync($"/api/v1/docs/{key}/versions/1/snapshot.svg", _ct);
        var byViewer = await viewer.PutAsJsonAsync($"/api/v1/docs/{key}/versions/1/snapshot", new { svg = Svg }, _ct);
        var stored = await (await owner.PutAsJsonAsync($"/api/v1/docs/{key}/versions/1/snapshot", new { svg = Svg }, _ct)).ReadAsync<StoreDocSnapshot.Result>();
        var again = await (await owner.PutAsJsonAsync($"/api/v1/docs/{key}/versions/1/snapshot", new { svg = OtherSvg }, _ct)).ReadAsync<StoreDocSnapshot.Result>();
        var noVersion = await owner.PutAsJsonAsync($"/api/v1/docs/{key}/versions/9/snapshot", new { svg = Svg }, _ct);
        var afterEmbed = (await viewer.GetDocAsync(page.Key)).Embeds.Single();
        var seenByViewer = await viewer.GetAsync(afterEmbed.SnapshotUrl, _ct);
        var mcpDoc = await CallAsync(mcp, "get_doc", new() { ["docKey"] = key });

        // Assert
        Assert.Null(beforeView.SnapshotUrl);
        Assert.Equal((DiagramFormat.Canvas, null, null), (beforeEmbed.DiagramFormat, beforeEmbed.Content, beforeEmbed.SnapshotUrl));
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.SnapshotNotFound);
        Assert.Equal(HttpStatusCode.Forbidden, byViewer.StatusCode);
        Assert.True(stored.Stored);
        Assert.False(again.Stored);
        await noVersion.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.VersionNotFound);
        Assert.Equal(stored.SnapshotUrl, afterEmbed.SnapshotUrl);
        Assert.Equal(Svg, await seenByViewer.Content.ReadAsStringAsync(_ct));
        Assert.Equal("API\nDB\nAPI → DB", mcpDoc.GetProperty("outline").GetString());
        Assert.Equal(stored.SnapshotUrl, mcpDoc.GetProperty("snapshotUrl").GetString());
        var id = created.GetProperty("id").GetGuid();
        Assert.Equal(1, await api.WithDbAsync(db => db.DocVersions.CountAsync(v => v.NodeId == id, _ct)));
    }

    [Fact]
    public async Task Restore_and_duplicate_keep_the_picture_of_the_version_they_copy()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("CRD");
        var canvas = await client.CreateDocAsync("CRD", new { kind = "Diagram", diagramFormat = "Canvas", title = "Flow", content = ApiToDb(), snapshot = Svg });
        await (await client.PatchDocAsync(canvas.Key, new { content = ApiToDb("v2"), baseVersion = 1, snapshot = OtherSvg })).ReadAsync<DocDto>();

        // Act
        var restored = await (await client.PostAsync($"/api/v1/docs/{canvas.Key}/versions/1/restore", null, _ct)).ReadAsync<DocDto>();
        var copy = await (await client.PostAsync($"/api/v1/docs/{canvas.Key}/duplicate", null, _ct)).ReadAsync<DocDto>(HttpStatusCode.Created);

        // Assert
        Assert.Equal((3, "API\nDB\nAPI → DB"), (restored.Version, restored.Outline));
        Assert.Equal(Svg, await client.GetStringAsync(restored.SnapshotUrl, _ct));
        Assert.Equal(restored.Outline, copy.Outline);
        Assert.Equal(Svg, await client.GetStringAsync(copy.SnapshotUrl, _ct));
    }

    [Fact]
    public async Task Outsiders_get_the_same_404_for_pictures_as_for_missing_docs()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("CSEC");
        var canvas = await owner.CreateDocAsync("CSEC", new { kind = "Diagram", diagramFormat = "Canvas", title = "Secret", content = ApiToDb(), snapshot = Svg });
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var read = await outsider.GetAsync(canvas.SnapshotUrl, _ct);
        var readMissing = await outsider.GetAsync("/api/v1/docs/CSEC-D-999/versions/1/snapshot.svg", _ct);
        var write = await outsider.PutAsJsonAsync($"/api/v1/docs/{canvas.Key}/versions/1/snapshot", new { svg = Svg }, _ct);
        var writeMissing = await outsider.PutAsJsonAsync("/api/v1/docs/CSEC-D-999/versions/1/snapshot", new { svg = Svg }, _ct);

        // Assert
        foreach (var (hidden, missing) in new[] { (read, readMissing), (write, writeMissing) })
        {
            Assert.Equal((HttpStatusCode.NotFound, HttpStatusCode.NotFound), (hidden.StatusCode, missing.StatusCode));
            var hiddenBody = await hidden.Content.ReadFromJsonAsync<JsonElement>(_ct);
            var missingBody = await missing.Content.ReadFromJsonAsync<JsonElement>(_ct);
            Assert.Equal(missingBody.GetProperty("code").GetString(), hiddenBody.GetProperty("code").GetString());
            Assert.Equal(
                missingBody.GetProperty("title").GetString()!.Replace("CSEC-D-999", canvas.Key, StringComparison.Ordinal),
                hiddenBody.GetProperty("title").GetString());
        }
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        var payload = JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
        Assert.True(result.IsError != true, $"{tool} failed: {payload}");
        return payload;
    }
}
