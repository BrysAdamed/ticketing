using System.Net;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Docs;
using Ticketing.Application.Search;
using Ticketing.Domain.Docs;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Arrange and act helpers for docs search: REST calls plus the pieces other stories will fill (outline, references).</summary>
public static class DocSearchTestData
{
    public static async Task<DocSearchPage> SearchDocsAsync(this HttpClient client, string query, HttpStatusCode expected = HttpStatusCode.OK) =>
        await (await client.GetAsync($"/api/v1/docs/search?{query}")).ReadAsync<DocSearchPage>(expected);

    public static async Task<List<string>> SearchDocKeysAsync(this HttpClient client, string query) =>
        [.. (await client.SearchDocsAsync(query)).Items.Select(d => d.Key)];

    public static async Task<List<QuickJumpItem>> QuickJumpAsync(this HttpClient client, string text, string? scope = null) =>
        await (await client.GetAsync($"/api/v1/quick-jump?q={Uri.EscapeDataString(text)}{(scope is null ? "" : $"&scope={scope}")}")).ReadAsync<List<QuickJumpItem>>();

    public static Task<DocDto> CreateDiagramAsync(this HttpClient client, string projectKey, string title, string format, string content, string? parent = null) =>
        client.CreateDocAsync(projectKey, new { kind = "Diagram", diagramFormat = format, title, parent, content });

    /// <summary>Sets a Canvas outline the way the Canvas story's publisher will.</summary>
    public static Task SetOutlineAsync(this TicketingApiFactory api, Guid docId, string outline) =>
        api.WithDbAsync(async db =>
        {
            var node = await db.DocNodes.SingleAsync(n => n.Id == docId);
            node.SetOutline(outline);
            return await db.SaveChangesAsync();
        });

    /// <summary>Writes a mention into the reference index directly, without the ticket key in the content (publishing one does the same).</summary>
    public static Task MentionAsync(this TicketingApiFactory api, Guid docId, Guid ticketId) =>
        api.WithDbAsync(async db =>
        {
            db.DocReferences.Add(DocReference.Create(docId, DocReferenceTarget.Ticket, ticketId));
            return await db.SaveChangesAsync();
        });

    public static Task TouchAsync(this TicketingApiFactory api, Guid docId, DateTimeOffset updatedAt) =>
        api.WithDbAsync(db => db.DocNodes.Where(n => n.Id == docId).ExecuteUpdateAsync(s => s.SetProperty(n => n.UpdatedAt, updatedAt)));

    public static string Highlighted(this DocSnippetDto snippet) =>
        string.Join("|", snippet.Highlights.Select(h => snippet.Text.Substring(h.Start, h.Length)));
}
