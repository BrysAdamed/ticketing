using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Docs;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>
/// Doc links, backlinks and ticket mentions (TKT-16, refinement 1.9): publishing rebuilds the reference index, and every read of
/// it (references, embeds, backlinks, a ticket's docs, the <c>mentions</c> search filter, MCP) shows only what the reader can read.
/// </summary>
[Collection(nameof(DocsCollection))]
public sealed class DocLinkTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Publishing_indexes_ticket_keys_doc_keys_links_and_embeds_but_not_code_and_rebuilds_on_every_publish()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("LNA");
        await client.CreateProjectAsync("LNB");
        var first = await client.CreateTicketAsync("LNA", "Charge the card");
        var second = await client.CreateTicketAsync("LNB", "Refund flow", "Bug");
        var runbook = await client.CreatePageAsync("LNA", "Runbook");
        var flow = await client.CreateDiagramAsync("LNA", "Checkout flow", "Mermaid", "flowchart LR\n  Shop --> Ledger");

        // Act
        var page = await client.CreatePageAsync("LNA", "Payments", content:
            $"Work in {first.Key}; see [the runbook]({runbook.Key}).\n\n`{second.Key}` is code.\n\n![Checkout]({flow.Key})\n\nNOPE-1 and LNA-D-999 are unknown.");
        var runbookBacklinks = (await client.GetDocAsync(runbook.Key)).Backlinks;
        var ticketDocs = await TicketDocsAsync(client, first.Key);
        var mentioning = await client.SearchDocKeysAsync($"mentions={first.Key}");
        var updated = await (await client.PatchDocAsync(page.Key, new { content = $"Now {second.Key} and {page.Key} itself.", baseVersion = 1 }))
            .ReadAsync<DocDto>();
        var backlinksAfterUpdate = (await client.GetDocAsync(runbook.Key)).Backlinks.Total;
        var ticketDocsAfterUpdate = (await TicketDocsAsync(client, first.Key)).Total;
        var edited = await (await client.PostAsJsonAsync(
                $"/api/v1/docs/{page.Key}/edits", new { edits = new[] { new { oldText = second.Key, newText = $"{first.Key} [x]({runbook.Key})" } } }, _ct))
            .ReadAsync<DocDto>();

        // Assert
        Assert.Equal([first.Key], page.References.Tickets.Select(t => t.Key));
        var chip = page.References.Tickets[0];
        Assert.Equal(("Charge the card", TicketType.UserStory, TicketStatus.ToDo, $"/tickets/{first.Key}"), (chip.Title, chip.Type, chip.Status, chip.Url));
        Assert.Equal(new[] { runbook.Key, flow.Key }.Order(StringComparer.Ordinal), page.References.Docs.Select(d => d.Key).Order(StringComparer.Ordinal));
        var embed = Assert.Single(page.Embeds);
        Assert.Equal((flow.Key, DiagramFormat.Mermaid, 1, "flowchart LR\n  Shop --> Ledger", "Checkout flow"), (embed.Key, embed.DiagramFormat, embed.Version, embed.Content, embed.Title));
        Assert.Equal(1, runbookBacklinks.Total);
        var backlink = Assert.Single(runbookBacklinks.Items);
        Assert.Equal((page.Key, "Payments", "Payments"), (backlink.Key, backlink.Title, backlink.Path));
        Assert.Equal([page.Key], ticketDocs.Items.Select(d => d.Key));
        Assert.Equal([page.Key], mentioning);
        Assert.Equal([second.Key], updated.References.Tickets.Select(t => t.Key));
        Assert.Empty(updated.References.Docs);
        Assert.Empty(updated.Embeds);
        Assert.Equal((0, 0), (backlinksAfterUpdate, ticketDocsAfterUpdate));
        Assert.Equal([first.Key], edited.References.Tickets.Select(t => t.Key));
        Assert.Equal([runbook.Key], edited.References.Docs.Select(d => d.Key));
        Assert.Equal(2, await api.WithDbAsync(db => db.DocReferences.CountAsync(r => r.SourceNodeId == page.Id, _ct)));
    }

    [Fact]
    public async Task A_tickets_docs_are_newest_first_capped_with_a_total_and_follow_deletes_and_restores()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("LNC");
        var ticket = await client.CreateTicketAsync("LNC", "Popular ticket");
        var target = await client.CreatePageAsync("LNC", "Target");
        var pages = new List<DocDto>();
        for (var i = 1; i <= 22; i++)
            pages.Add(await client.CreatePageAsync("LNC", $"Mention {i:00}", content: $"About {ticket.Key} and {target.Key}."));
        await api.WithDbAsync(db => db.DocNodes.Where(n => n.Id == pages[0].Id).ExecuteUpdateAsync(s => s.SetProperty(n => n.UpdatedAt, DateTimeOffset.UtcNow.AddDays(1)), _ct));
        var deleted = pages[1];

        // Act
        var all = await TicketDocsAsync(client, ticket.Key);
        var limited = await TicketDocsAsync(client, ticket.Key, "?limit=5");
        (await client.DeleteAsync($"/api/v1/docs/{deleted.Key}", _ct)).EnsureSuccessStatusCode();
        var afterDelete = await TicketDocsAsync(client, ticket.Key);
        var backlinksAfterDelete = (await client.GetDocAsync(target.Key)).Backlinks;
        (await client.PostAsync($"/api/v1/docs/{deleted.Key}/restore", null, _ct)).EnsureSuccessStatusCode();
        var afterRestore = await TicketDocsAsync(client, ticket.Key);
        var badLimit = await client.GetAsync($"/api/v1/tickets/{ticket.Key}/docs?limit=101", _ct);

        // Assert
        Assert.Equal((22, GetTicketDocs.DefaultLimit), (all.Total, all.Items.Count));
        Assert.Equal(pages[0].Key, all.Items[0].Key);
        Assert.Equal(pages[21].Key, all.Items[1].Key);
        Assert.Equal((22, 5), (limited.Total, limited.Items.Count));
        Assert.Equal(21, afterDelete.Total);
        Assert.DoesNotContain(deleted.Key, afterDelete.Items.Select(d => d.Key));
        Assert.Equal(21, backlinksAfterDelete.Total);
        Assert.DoesNotContain(deleted.Key, backlinksAfterDelete.Items.Select(d => d.Key));
        Assert.Equal(22, afterRestore.Total);
        Assert.Equal(HttpStatusCode.BadRequest, badLimit.StatusCode);
    }

    [Fact]
    public async Task Deleted_targets_show_as_deleted_docs_without_title_and_deleted_tickets_drop_out()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("LND");
        var ticket = await client.CreateTicketAsync("LND", "Short-lived");
        var old = await client.CreatePageAsync("LND", "Old design");
        var page = await client.CreatePageAsync("LND", "Current", content: $"Replaces {old.Key}, tracked in {ticket.Key}.");
        (await client.DeleteAsync($"/api/v1/docs/{old.Key}", _ct)).EnsureSuccessStatusCode();
        (await client.DeleteAsync($"/api/v1/tickets/{ticket.Key}", _ct)).EnsureSuccessStatusCode();

        // Act
        var read = await client.GetDocAsync(page.Key);

        // Assert
        Assert.Empty(read.References.Tickets);
        var gone = Assert.Single(read.References.Docs);
        Assert.Equal((old.Key, true, null, null), (gone.Key, gone.Deleted, gone.Title, gone.Url));
    }

    [Fact]
    public async Task Outsiders_never_see_private_references_embeds_backlinks_or_ticket_docs()
    {
        // Arrange
        var ownerUser = await api.CreateUserAsync();
        var outsiderUser = await api.CreateUserAsync();
        var owner = await api.LoginAsync(ownerUser);
        await owner.CreateProjectAsync("LNP", ProjectVisibility.Public);
        await owner.CreateProjectAsync("LNS");
        var publicTicket = await owner.CreateTicketAsync("LNP", "Open ticket");
        var privateTicket = await owner.CreateTicketAsync("LNS", "Confidential merger");
        var privateDiagram = await owner.CreateDiagramAsync("LNS", "Secret topology", "Mermaid", "flowchart LR\n  Vault --> Bank");
        var privateSpec = await owner.CreatePageAsync("LNS", "Secret spec", content: $"Builds on {publicTicket.Key}.");
        var publicPage = await owner.CreatePageAsync("LNP", "Public notes", content:
            $"Mentions {publicTicket.Key}, {privateTicket.Key} and {privateSpec.Key}.\n\n![Topology]({privateDiagram.Key})");
        (await owner.PatchDocAsync(privateSpec.Key, new { content = $"Builds on {publicTicket.Key} and links [public notes]({publicPage.Key}).", baseVersion = 1 }))
            .EnsureSuccessStatusCode();
        var outsider = await api.LoginAsync(outsiderUser);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(outsiderUser));
        await using var ownerMcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(ownerUser));

        // Act
        var asOutsider = await outsider.GetDocAsync(publicPage.Key);
        var rawAsOutsider = await (await outsider.GetAsync($"/api/v1/docs/{publicPage.Key}", _ct)).Content.ReadAsStringAsync(_ct);
        var asOwner = await owner.GetDocAsync(publicPage.Key);
        var outsiderTicketDocs = await TicketDocsAsync(outsider, publicTicket.Key);
        var ownerTicketDocs = await TicketDocsAsync(owner, publicTicket.Key);
        var hiddenTicket = await outsider.GetAsync($"/api/v1/tickets/{privateTicket.Key}/docs", _ct);
        var missingTicket = await outsider.GetAsync("/api/v1/tickets/LNS-999/docs", _ct);
        var mcpDoc = await CallAsync(mcp, "get_doc", new() { ["docKey"] = publicPage.Key });
        var mcpTicket = await CallAsync(mcp, "get_ticket", new() { ["key"] = publicTicket.Key, ["include"] = new[] { "docs" } });
        var ownerMcpTicket = await CallAsync(ownerMcp, "get_ticket", new() { ["key"] = publicTicket.Key });

        // Assert
        Assert.Equal([publicTicket.Key], asOutsider.References.Tickets.Select(t => t.Key));
        Assert.Empty(asOutsider.References.Docs);
        Assert.Empty(asOutsider.Embeds);
        Assert.Equal(0, asOutsider.Backlinks.Total);
        Assert.DoesNotContain("Confidential", rawAsOutsider, StringComparison.Ordinal);
        Assert.DoesNotContain("Secret", rawAsOutsider, StringComparison.Ordinal);
        Assert.DoesNotContain("Vault", rawAsOutsider, StringComparison.Ordinal);
        Assert.Equal(new[] { publicTicket.Key, privateTicket.Key }.Order(StringComparer.Ordinal), asOwner.References.Tickets.Select(t => t.Key).Order(StringComparer.Ordinal));
        Assert.Equal([privateDiagram.Key], asOwner.Embeds.Select(e => e.Key));
        Assert.Equal([privateSpec.Key], asOwner.Backlinks.Items.Select(d => d.Key));
        Assert.Equal(1, outsiderTicketDocs.Total);
        Assert.Equal([publicPage.Key], outsiderTicketDocs.Items.Select(d => d.Key));
        Assert.Equal(2, ownerTicketDocs.Total);
        Assert.Equal(HttpStatusCode.NotFound, hiddenTicket.StatusCode);
        Assert.Equal(
            (await missingTicket.Content.ReadFromJsonAsync<JsonElement>(_ct)).GetProperty("code").GetString(),
            (await hiddenTicket.Content.ReadFromJsonAsync<JsonElement>(_ct)).GetProperty("code").GetString());
        Assert.Equal([publicTicket.Key], mcpDoc.GetProperty("references").GetProperty("tickets").EnumerateArray().Select(t => t.GetProperty("key").GetString()));
        Assert.Empty(mcpDoc.GetProperty("embeds").EnumerateArray());
        Assert.DoesNotContain("Confidential", mcpDoc.GetRawText(), StringComparison.Ordinal);
        Assert.Equal(1, mcpTicket.GetProperty("docs").GetProperty("total").GetInt32());
        Assert.Equal(2, ownerMcpTicket.GetProperty("docs").GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task An_older_version_resolves_its_own_references_and_embeds_not_the_latest_ones()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("LNV");
        var oldTicket = await client.CreateTicketAsync("LNV", "First approach");
        var newTicket = await client.CreateTicketAsync("LNV", "Second approach");
        var flow = await client.CreateDiagramAsync("LNV", "Old flow", "Mermaid", "flowchart LR\n  A --> B");
        var page = await client.CreatePageAsync("LNV", "Design", content: $"Tracked in {oldTicket.Key}.\n\n![Flow]({flow.Key})\n\n`{newTicket.Key}` is code.");
        (await client.PatchDocAsync(page.Key, new { content = $"Now tracked in {newTicket.Key} and {page.Key}.", baseVersion = 1 })).EnsureSuccessStatusCode();

        // Act
        var latest = await client.GetDocAsync(page.Key);
        var atV1 = await (await client.GetAsync($"/api/v1/docs/{page.Key}?version=1", _ct)).ReadAsync<DocDto>();
        var v1 = await (await client.GetAsync($"/api/v1/docs/{page.Key}/versions/1", _ct)).ReadAsync<DocVersionDto>();
        var v2 = await (await client.GetAsync($"/api/v1/docs/{page.Key}/versions/2", _ct)).ReadAsync<DocVersionDto>();

        // Assert
        Assert.Equal([newTicket.Key], latest.References.Tickets.Select(t => t.Key));
        Assert.Empty(latest.Embeds);
        foreach (var (references, embeds) in new[] { (atV1.References, atV1.Embeds), (v1.References, v1.Embeds) })
        {
            Assert.Equal([oldTicket.Key], references.Tickets.Select(t => t.Key));
            Assert.Equal([flow.Key], references.Docs.Select(d => d.Key));
            var embed = Assert.Single(embeds);
            Assert.Equal((flow.Key, "flowchart LR\n  A --> B"), (embed.Key, embed.Content));
        }
        Assert.Equal([newTicket.Key], v2.References.Tickets.Select(t => t.Key));
        Assert.Empty(v2.References.Docs);
        Assert.Equal(1, await api.WithDbAsync(db => db.DocReferences.CountAsync(r => r.SourceNodeId == page.Id, _ct)));
    }

    [Fact]
    public async Task Outsiders_never_see_private_references_or_embeds_of_an_older_version()
    {
        // Arrange
        var ownerUser = await api.CreateUserAsync();
        var outsiderUser = await api.CreateUserAsync();
        var owner = await api.LoginAsync(ownerUser);
        await owner.CreateProjectAsync("LNVP", ProjectVisibility.Public);
        await owner.CreateProjectAsync("LNVS");
        var publicTicket = await owner.CreateTicketAsync("LNVP", "Open ticket");
        var privateTicket = await owner.CreateTicketAsync("LNVS", "Confidential merger");
        var privateDiagram = await owner.CreateDiagramAsync("LNVS", "Secret topology", "Mermaid", "flowchart LR\n  Vault --> Bank");
        var page = await owner.CreatePageAsync("LNVP", "Public notes", content:
            $"Mentions {publicTicket.Key} and {privateTicket.Key}.\n\n![Topology]({privateDiagram.Key})");
        (await owner.PatchDocAsync(page.Key, new { content = "Nothing to see.", baseVersion = 1 })).EnsureSuccessStatusCode();
        var outsider = await api.LoginAsync(outsiderUser);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(outsiderUser));

        // Act
        var rawDoc = await (await outsider.GetAsync($"/api/v1/docs/{page.Key}?version=1", _ct)).Content.ReadAsStringAsync(_ct);
        var version = await (await outsider.GetAsync($"/api/v1/docs/{page.Key}/versions/1", _ct)).ReadAsync<DocVersionDto>();
        var rawVersion = await (await outsider.GetAsync($"/api/v1/docs/{page.Key}/versions/1", _ct)).Content.ReadAsStringAsync(_ct);
        var mcpDoc = await CallAsync(mcp, "get_doc", new() { ["docKey"] = page.Key, ["version"] = 1 });
        var asOwner = await (await owner.GetAsync($"/api/v1/docs/{page.Key}/versions/1", _ct)).ReadAsync<DocVersionDto>();

        // Assert
        Assert.Equal([publicTicket.Key], version.References.Tickets.Select(t => t.Key));
        Assert.Empty(version.References.Docs);
        Assert.Empty(version.Embeds);
        foreach (var raw in new[] { rawDoc, rawVersion, mcpDoc.GetRawText() })
        {
            Assert.DoesNotContain("Confidential", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("Secret", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("Vault", raw, StringComparison.Ordinal);
        }
        Assert.Equal([publicTicket.Key], mcpDoc.GetProperty("references").GetProperty("tickets").EnumerateArray().Select(t => t.GetProperty("key").GetString()));
        Assert.Equal(new[] { publicTicket.Key, privateTicket.Key }.Order(StringComparer.Ordinal), asOwner.References.Tickets.Select(t => t.Key).Order(StringComparer.Ordinal));
        Assert.Equal([privateDiagram.Key], asOwner.Embeds.Select(e => e.Key));
    }

    [Fact]
    public async Task The_rest_ticket_read_leaves_docs_out_unless_asked()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("LNE");
        var ticket = await client.CreateTicketAsync("LNE", "Ticket");
        await client.CreatePageAsync("LNE", "Spec", content: $"Implements {ticket.Key}.");

        // Act
        var plain = await (await client.GetAsync($"/api/v1/tickets/{ticket.Key}", _ct)).Content.ReadFromJsonAsync<JsonElement>(_ct);
        var withDocs = await (await client.GetAsync($"/api/v1/tickets/{ticket.Key}?include=docs", _ct)).Content.ReadFromJsonAsync<JsonElement>(_ct);

        // Assert
        Assert.Equal(JsonValueKind.Null, plain.GetProperty("docs").ValueKind);
        Assert.Equal(1, withDocs.GetProperty("docs").GetProperty("total").GetInt32());
    }

    private static async Task<DocMentionsDto> TicketDocsAsync(HttpClient client, string ticketKey, string query = "") =>
        await (await client.GetAsync($"/api/v1/tickets/{ticketKey}/docs{query}")).ReadAsync<DocMentionsDto>();

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        var payload = JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
        Assert.True(result.IsError != true, $"{tool} failed: {payload}");
        return payload;
    }
}
