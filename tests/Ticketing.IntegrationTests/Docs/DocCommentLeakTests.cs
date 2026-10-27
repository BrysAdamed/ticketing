using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Protocol;
using Ticketing.Domain.Comments;
using Ticketing.Domain.Docs;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Comments of private-project docs never leak (spec 1.5): outsiders get exactly what a missing doc or comment answers.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocCommentLeakTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Outsiders_get_the_same_404_as_for_missing_docs_and_comments_over_rest()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("HUSH");
        var page = await owner.CreatePageAsync("HUSH", "Plans");
        var comment = await owner.AddDocCommentAsync(page.Key, "secret remark");
        var outsider = await api.LoginAsync(await api.CreateUserAsync());
        var missing = Guid.NewGuid();

        // Act + Assert
        await SameAsMissingAsync(
            await outsider.GetAsync($"/api/v1/docs/{page.Key}/comments", _ct), await outsider.GetAsync("/api/v1/docs/HUSH-D-999/comments", _ct), page.Key, "HUSH-D-999");
        await SameAsMissingAsync(await outsider.PostDocCommentAsync(page.Key, "x"), await outsider.PostDocCommentAsync("HUSH-D-999", "x"), page.Key, "HUSH-D-999");
        await SameAsMissingAsync(await outsider.PatchDocCommentAsync(comment.Id, "x"), await outsider.PatchDocCommentAsync(missing, "x"), null, null);
        await SameAsMissingAsync(await outsider.DeleteDocCommentAsync(comment.Id), await outsider.DeleteDocCommentAsync(missing), null, null);
        Assert.Equal("secret remark", await api.WithDbAsync(db => db.Comments.Where(c => c.Id == comment.Id).Select(c => c.Body).SingleAsync(_ct)));
    }

    [Fact]
    public async Task Outsiders_get_not_found_from_the_mcp_doc_comment_tools()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("MUTE");
        var page = await owner.CreatePageAsync("MUTE", "Plans");
        var comment = await owner.AddDocCommentAsync(page.Key, "secret remark");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(await api.CreateUserAsync()));

        // Act
        var list = await mcp.CallToolAsync("list_doc_comments", new Dictionary<string, object?> { ["docKey"] = page.Key }, cancellationToken: _ct);
        var missingList = await mcp.CallToolAsync("list_doc_comments", new Dictionary<string, object?> { ["docKey"] = "MUTE-D-999" }, cancellationToken: _ct);
        var add = await mcp.CallToolAsync("add_doc_comment", new Dictionary<string, object?> { ["docKey"] = page.Key, ["body"] = "x" }, cancellationToken: _ct);
        var update = await mcp.CallToolAsync("update_doc_comment", new Dictionary<string, object?> { ["commentId"] = comment.Id, ["body"] = "x" }, cancellationToken: _ct);
        var missingUpdate = await mcp.CallToolAsync("update_doc_comment", new Dictionary<string, object?> { ["commentId"] = Guid.NewGuid(), ["body"] = "x" }, cancellationToken: _ct);
        var delete = await mcp.CallToolAsync("delete_doc_comment", new Dictionary<string, object?> { ["commentId"] = comment.Id }, cancellationToken: _ct);

        // Assert
        Assert.Equal(DocErrors.NotFound, Code(list));
        Assert.Equal(Message(missingList).Replace("MUTE-D-999", page.Key, StringComparison.Ordinal), Message(list));
        Assert.Equal(DocErrors.NotFound, Code(add));
        Assert.Equal(CommentErrors.NotFound, Code(update));
        Assert.Equal(Message(missingUpdate), Message(update));
        Assert.Equal(CommentErrors.NotFound, Code(delete));
    }

    [Fact]
    public async Task Docs_search_never_matches_or_quotes_comments()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("QUIET");
        var page = await owner.CreatePageAsync("QUIET", "Plans", content: "Nothing to see");
        await owner.AddDocCommentAsync(page.Key, "zanzibarite is the codeword");

        // Act
        var response = await owner.GetAsync("/api/v1/docs/search?project=QUIET&q=zanzibarite", _ct);
        var quickJump = await owner.GetAsync("/api/v1/quick-jump?q=zanzibarite&scope=Docs", _ct);

        // Assert
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(_ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(body.GetProperty("items").EnumerateArray());
        Assert.DoesNotContain("zanzibarite", await quickJump.Content.ReadAsStringAsync(_ct), StringComparison.Ordinal);
    }

    private async Task SameAsMissingAsync(HttpResponseMessage hidden, HttpResponseMessage missing, string? hiddenRef, string? missingRef)
    {
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        var hiddenBody = await hidden.Content.ReadFromJsonAsync<JsonElement>(_ct);
        var missingBody = await missing.Content.ReadFromJsonAsync<JsonElement>(_ct);
        Assert.Equal(missingBody.GetProperty("code").GetString(), hiddenBody.GetProperty("code").GetString());
        var missingTitle = missingBody.GetProperty("title").GetString()!;
        Assert.Equal(missingRef is null ? missingTitle : missingTitle.Replace(missingRef, hiddenRef!, StringComparison.Ordinal), hiddenBody.GetProperty("title").GetString());
    }

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;

    private static string? Code(CallToolResult result)
    {
        Assert.True(result.IsError);
        return Payload(result).GetProperty("code").GetString();
    }

    private static string Message(CallToolResult result) => Payload(result).GetProperty("message").GetString()!;
}
