using System.Net;
using System.Net.Http.Json;
using Ticketing.Application.Comments;
using Ticketing.Application.Common;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Arrange and act helpers for doc comments, through the real REST API.</summary>
public static class DocCommentTestData
{
    public static Task<HttpResponseMessage> PostDocCommentAsync(this HttpClient client, string docKey, string body) =>
        client.PostAsJsonAsync($"/api/v1/docs/{docKey}/comments", new { body }, HttpAssertions.Json);

    public static async Task<DocCommentDto> AddDocCommentAsync(this HttpClient client, string docKey, string body) =>
        await (await client.PostDocCommentAsync(docKey, body)).ReadAsync<DocCommentDto>(HttpStatusCode.Created);

    public static async Task<CursorPage<DocCommentDto>> DocCommentsAsync(this HttpClient client, string docKey, string query = "") =>
        await (await client.GetAsync($"/api/v1/docs/{docKey}/comments{query}")).ReadAsync<CursorPage<DocCommentDto>>();

    public static Task<HttpResponseMessage> PatchDocCommentAsync(this HttpClient client, Guid commentId, string body) =>
        client.PatchAsJsonAsync($"/api/v1/docs/comments/{commentId}", new { body }, HttpAssertions.Json);

    public static Task<HttpResponseMessage> DeleteDocCommentAsync(this HttpClient client, Guid commentId) =>
        client.DeleteAsync($"/api/v1/docs/comments/{commentId}");
}
