using System.Net;
using System.Net.Http.Json;
using Ticketing.Application.Boards;
using Ticketing.Application.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Boards;

[CollectionDefinition(nameof(BoardsCollection))]
public sealed class BoardsCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>Arrange and act helpers for the boards slice, all through the real API.</summary>
public static class BoardTestData
{
    public static async Task<BoardDto> CreateBoardAsync(this HttpClient client, string name, params string[] projectKeys)
    {
        var response = await client.PostAsJsonAsync("/api/v1/boards", new { name, projectKeys }, HttpAssertions.Json);
        return await response.ReadAsync<BoardDto>(HttpStatusCode.Created);
    }

    public static async Task<BoardDto> GetBoardAsync(this HttpClient client, Guid boardId, string query = "") =>
        await (await client.GetAsync($"/api/v1/boards/{boardId}{query}")).ReadAsync<BoardDto>();

    public static Task<HttpResponseMessage> MoveAsync(
        this HttpClient client, string target, string[] keys, string? status = null, string? beforeKey = null, string? afterKey = null) =>
        client.PostAsJsonAsync("/api/v1/tickets/move", new { keys, target, status, beforeKey, afterKey }, HttpAssertions.Json);

    public static async Task<IReadOnlyList<TicketSummaryDto>> MoveOkAsync(
        this HttpClient client, string target, string[] keys, string? status = null, string? beforeKey = null, string? afterKey = null) =>
        await (await client.MoveAsync(target, keys, status, beforeKey, afterKey)).ReadAsync<List<TicketSummaryDto>>();

    public static Task<HttpResponseMessage> PatchBoardAsync(this HttpClient client, Guid boardId, object body) =>
        client.PatchAsJsonAsync($"/api/v1/boards/{boardId}", body, HttpAssertions.Json);

    /// <summary>Card keys per column, in column order, skipping empty columns: <c>"Review: WEB-1, WEB-3"</c>.</summary>
    public static string[] Layout(this BoardDto board) =>
        [.. board.Columns.Where(c => c.Cards.Count > 0).Select(c => $"{c.Status}: {string.Join(", ", c.Cards.Select(card => card.Key))}")];

    public static string[] Keys(this BoardDto board) => [.. board.Columns.SelectMany(c => c.Cards).Select(c => c.Key)];
}
