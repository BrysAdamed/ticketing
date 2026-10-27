using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Docs;
using Ticketing.Application.Search;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Docs search (TKT-19, refinement 1.10): text, filters, sorts, snippets, quick jump and the <c>search_docs</c> MCP tool.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocSearchTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Text_matches_titles_content_and_canvas_labels_best_match_first_with_plain_snippets()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("SRA");
        var flow = await client.CreatePageAsync("SRA", "Payment flow", content:
            "# Payment flow\n\nThe order id is the **idempotency** key, so a double click on Pay never creates two charges.");
        var rules = await client.CreatePageAsync("SRA", "Idempotency rules", content: "Short page.");
        var mermaid = await client.CreateDiagramAsync("SRA", "Checkout sequence", "Mermaid", "sequenceDiagram\n  Shop->>Ledger: idempotent charge");
        var canvas = await client.CreateDiagramAsync("SRA", "Architecture sketch", "Canvas", "{}");
        await api.SetOutlineAsync(canvas.Id, "API → Ledger\nIdempotency store");
        await client.CreatePageAsync("SRA", "Unrelated", content: "Nothing to see.");

        // Act
        var result = await client.SearchDocsAsync("q=idempotency&project=SRA");

        // Assert
        Assert.Equal(DocSearchSort.Relevance, result.Sort);
        Assert.Null(result.NextCursor);
        Assert.Equal(4, result.Total);
        Assert.Equal(rules.Key, result.Items[0].Key);
        Assert.Equal(new[] { flow.Key, mermaid.Key, canvas.Key, rules.Key }.Order(StringComparer.Ordinal), result.Items.Select(i => i.Key).Order(StringComparer.Ordinal));
        var flowHit = result.Items.Single(i => i.Key == flow.Key);
        Assert.Contains("idempotency key, so a double click", flowHit.Snippet!.Text, StringComparison.Ordinal);
        Assert.Equal("idempotency", flowHit.Snippet.Highlighted());
        Assert.DoesNotContain("*", flowHit.Snippet.Text, StringComparison.Ordinal);
        Assert.DoesNotContain("\n", flowHit.Snippet.Text, StringComparison.Ordinal);
        Assert.Equal("idempotent", result.Items.Single(i => i.Key == mermaid.Key).Snippet!.Highlighted());
        Assert.Equal("Idempotency", result.Items.Single(i => i.Key == canvas.Key).Snippet!.Highlighted());
        Assert.Equal((DocKind.Diagram, DiagramFormat.Canvas), (result.Items.Single(i => i.Key == canvas.Key).Kind, result.Items.Single(i => i.Key == canvas.Key).DiagramFormat));
        Assert.StartsWith($"/p/SRA/docs/{flow.Key}/payment-flow", flowHit.Url, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Partial_titles_keys_and_web_search_syntax_match()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("SRB");
        var folder = await client.CreateFolderAsync("SRB", "Runbooks");
        var outage = await client.CreatePageAsync("SRB", "Stripe outage", folder.Key, "Call the on-call engineer. Check the status page.");
        var deploy = await client.CreatePageAsync("SRB", "Deploy checklist", folder.Key, "Run the migrations, then check the status page.");

        // Act
        var partial = await client.SearchDocKeysAsync("q=outa");
        var byKey = await client.SearchDocKeysAsync($"q={outage.Key.ToLowerInvariant()}");
        var phrase = await client.SearchDocKeysAsync("q=" + Uri.EscapeDataString("\"status page\" -migrations"));
        var folders = await client.SearchDocKeysAsync("q=runbooks&kind=Folder");

        // Assert
        Assert.Equal([outage.Key], partial);
        Assert.Equal(outage.Key, byKey[0]);
        Assert.Equal([outage.Key], phrase);
        Assert.Equal([folder.Key], folders);
        Assert.DoesNotContain(deploy.Key, partial);
    }

    [Fact]
    public async Task Filters_by_project_kind_folder_subtree_mentions_and_updated_range()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("SRC");
        await client.CreateProjectAsync("SRD");
        var arch = await client.CreateFolderAsync("SRC", "Architecture");
        var adrs = await client.CreateFolderAsync("SRC", "ADRs", arch.Key);
        var adr = await client.CreatePageAsync("SRC", "0001 Use Postgres", adrs.Key);
        var overview = await client.CreatePageAsync("SRC", "Overview", arch.Key);
        var diagram = await client.CreateDiagramAsync("SRC", "Context", "Mermaid", "flowchart LR\n  A-->B", arch.Key);
        var rootPage = await client.CreatePageAsync("SRC", "Home");
        var other = await client.CreatePageAsync("SRD", "Elsewhere");
        var ticket = await client.CreateTicketAsync("SRC", "Adopt Postgres");
        await api.MentionAsync(adr.Id, ticket.Id);
        await api.TouchAsync(rootPage.Id, new DateTimeOffset(2026, 1, 15, 12, 0, 0, TimeSpan.Zero));

        // Act
        var srd = await client.SearchDocKeysAsync("project=SRD");
        var pages = await client.SearchDocKeysAsync("project=SRC&kind=Page");
        var diagrams = await client.SearchDocKeysAsync("project=SRC,SRD&kind=Diagram");
        var subtree = await client.SearchDocKeysAsync($"folder={arch.Key}");
        var nested = await client.SearchDocKeysAsync($"folder={adrs.Id}");
        var mentioning = await client.SearchDocKeysAsync($"mentions={ticket.Key}");
        var january = await client.SearchDocKeysAsync("project=SRC&updatedFrom=2026-01-01&updatedTo=2026-01-31");
        var notFolder = await client.GetAsync($"/api/v1/docs/search?folder={adr.Key}", _ct);

        // Assert
        Assert.Equal([other.Key], srd);
        Assert.Equal(new[] { rootPage.Key, overview.Key, adr.Key }.Order(StringComparer.Ordinal), pages.Order(StringComparer.Ordinal));
        Assert.Equal([diagram.Key], diagrams);
        Assert.Equal(new[] { adrs.Key, adr.Key, overview.Key, diagram.Key }.Order(StringComparer.Ordinal), subtree.Order(StringComparer.Ordinal));
        Assert.Equal([adr.Key], nested);
        Assert.Equal([adr.Key], mentioning);
        Assert.Equal([rootPage.Key], january);
        Assert.Equal(HttpStatusCode.BadRequest, notFolder.StatusCode);
    }

    [Fact]
    public async Task Without_text_results_are_newest_first_and_page_with_a_keyset_cursor()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("SRE");
        var created = new List<DocDto>();
        for (var i = 0; i < 7; i++)
            created.Add(await client.CreatePageAsync("SRE", $"Page {i}", content: $"Body {i}"));
        var same = DateTimeOffset.UtcNow.AddMinutes(-5);
        await api.TouchAsync(created[2].Id, same);
        await api.TouchAsync(created[3].Id, same);

        // Act
        var first = await client.SearchDocsAsync("project=SRE&limit=3");
        var second = await client.SearchDocsAsync($"project=SRE&limit=3&cursor={first.NextCursor}");
        var third = await client.SearchDocsAsync($"project=SRE&limit=3&cursor={second.NextCursor}");
        var sortedByText = await client.SearchDocsAsync("project=SRE&q=body&sort=updated&limit=100");

        // Assert
        Assert.Equal(DocSearchSort.Updated, first.Sort);
        Assert.Equal((7, false), (first.Total, first.TotalCapped));
        Assert.Null(second.Total);
        var keys = first.Items.Concat(second.Items).Concat(third.Items).Select(i => i.Key).ToList();
        Assert.Equal(7, keys.Distinct().Count());
        Assert.Null(third.NextCursor);
        Assert.Equal(created[6].Key, keys[0]);
        Assert.Equal(new[] { created[3].Key, created[2].Key }.Order(StringComparer.Ordinal), keys[^2..].Order(StringComparer.Ordinal));
        Assert.Equal(DocSearchSort.Updated, sortedByText.Sort);
        Assert.Equal("Body 6", sortedByText.Items[0].Snippet!.Text);
    }

    [Fact]
    public async Task Invalid_parameters_answer_400_with_every_field()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await client.GetAsync("/api/v1/docs/search?kind=Note&folder=WEB-12&mentions=WEB-D-1&updatedFrom=yesterday&sort=rank", _ct);
        var relevanceCursor = await client.GetAsync("/api/v1/docs/search?q=x&cursor=abc", _ct);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>(_ct)).GetProperty("errors");
        Assert.Equal(["folder", "kind", "mentions", "sort", "updatedFrom"], errors.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.Equal(HttpStatusCode.BadRequest, relevanceCursor.StatusCode);
    }

    [Fact]
    public async Task Quick_jump_opens_a_doc_key_and_lists_up_to_five_docs_after_tickets()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("SRF");
        await client.CreateTicketAsync("SRF", "Webhook retries");
        var folder = await client.CreateFolderAsync("SRF", "Runbooks");
        var docs = new List<DocDto>();
        for (var i = 0; i < 7; i++)
            docs.Add(await client.CreatePageAsync("SRF", $"Webhook guide {i}", folder.Key, "Replaying webhook events is safe."));

        // Act
        var byKey = await client.QuickJumpAsync(docs[3].Key.ToLowerInvariant());
        var byText = await client.QuickJumpAsync("webhook");

        // Assert
        Assert.Equal((QuickJumpKind.Doc, docs[3].Key, docs[3].Url, "Runbooks"), (byKey[0].Kind, byKey[0].Key, byKey[0].Url, byKey[0].FolderPath));
        Assert.Equal(DocKind.Page, byKey[0].DocKind);
        Assert.DoesNotContain(byKey.Skip(1), i => i.Key == docs[3].Key);
        Assert.Equal(QuickJumpKind.Ticket, byText[0].Kind);
        var docHits = byText.Where(i => i.Kind == QuickJumpKind.Doc).ToList();
        Assert.Equal(QuickJump.MaxDocMatches, docHits.Count);
        Assert.All(docHits, d => Assert.Equal("webhook", d.Snippet!.Highlighted(), ignoreCase: true));
        Assert.Equal(byText.Count - docHits.Count, byText.FindIndex(i => i.Kind == QuickJumpKind.Doc));
    }

    [Fact]
    public async Task Search_docs_mcp_tool_uses_the_same_rules_and_is_read_only()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("SRG");
        var page = await client.CreatePageAsync("SRG", "Release process", content: "Tag the release and deploy to staging.");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));

        // Act
        var tools = (await mcp.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).ToList();
        var found = await CallAsync(mcp, new() { ["text"] = "staging", ["projectKeys"] = new[] { "SRG" }, ["kinds"] = new[] { "Page" } });
        var invalid = await mcp.CallToolAsync("search_docs", new Dictionary<string, object?> { ["mentions"] = "nope" }, cancellationToken: _ct);

        // Assert
        Assert.Contains("search_docs", tools);
        var item = Assert.Single(found.GetProperty("items").EnumerateArray());
        Assert.Equal(page.Key, item.GetProperty("key").GetString());
        Assert.Equal("Relevance", found.GetProperty("sort").GetString());
        var snippet = item.GetProperty("snippet");
        var range = snippet.GetProperty("highlights")[0];
        Assert.Equal("staging", snippet.GetProperty("text").GetString()!.Substring(range.GetProperty("start").GetInt32(), range.GetProperty("length").GetInt32()));
        Assert.True(invalid.IsError);
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync("search_docs", arguments, cancellationToken: _ct);
        var payload = JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
        Assert.True(result.IsError != true, $"search_docs failed: {payload}");
        return payload;
    }
}
