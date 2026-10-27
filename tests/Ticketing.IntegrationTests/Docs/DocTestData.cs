using System.Net;
using System.Net.Http.Json;
using Ticketing.Application.Docs;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Docs;

[CollectionDefinition(nameof(DocsCollection))]
public sealed class DocsCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>Arrange helpers for the docs slice: docs created and read through the real REST API.</summary>
public static class DocTestData
{
    public static async Task<DocDto> CreateDocAsync(this HttpClient client, string projectKey, object body)
    {
        var response = await client.PostAsJsonAsync($"/api/v1/projects/{projectKey}/docs", body, HttpAssertions.Json);
        return await response.ReadAsync<DocDto>(HttpStatusCode.Created);
    }

    public static Task<DocDto> CreateFolderAsync(this HttpClient client, string projectKey, string title, string? parent = null) =>
        client.CreateDocAsync(projectKey, new { kind = "Folder", title, parent });

    public static Task<DocDto> CreatePageAsync(this HttpClient client, string projectKey, string title, string? parent = null, string content = "") =>
        client.CreateDocAsync(projectKey, new { kind = "Page", title, parent, content });

    public static async Task<DocDto> GetDocAsync(this HttpClient client, string key) =>
        await (await client.GetAsync($"/api/v1/docs/{key}")).ReadAsync<DocDto>();

    public static async Task<DocTreeDto> GetTreeAsync(this HttpClient client, string projectKey, string query = "") =>
        await (await client.GetAsync($"/api/v1/projects/{projectKey}/docs/tree{query}")).ReadAsync<DocTreeDto>();

    public static Task<HttpResponseMessage> PatchDocAsync(this HttpClient client, string key, object body) =>
        client.PatchAsJsonAsync($"/api/v1/docs/{key}", body, HttpAssertions.Json);

    public static Task<HttpResponseMessage> MoveDocAsync(this HttpClient client, string key, object body) =>
        client.PostAsJsonAsync($"/api/v1/docs/{key}/move", body, HttpAssertions.Json);

    public static IReadOnlyList<string> Titles(this DocTreeDto tree) => [.. tree.Items.Select(i => $"{new string('>', i.Depth - 1)}{i.Title}")];
}
