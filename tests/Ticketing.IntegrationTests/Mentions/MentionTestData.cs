using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Collaboration;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Mentions;

[CollectionDefinition(nameof(MentionsCollection))]
public sealed class MentionsCollection : ICollectionFixture<TicketingApiFactory>;

public static class MentionTestData
{
    public static string Mention(this TestUser user) => Ticketing.Domain.Collaboration.Mentions.Format(user.Id, user.DisplayName);

    public static Task<HttpResponseMessage> PostCommentAsync(this HttpClient client, string key, string body) =>
        client.PostAsJsonAsync($"/api/v1/tickets/{key}/comments", new { body }, HttpAssertions.Json);

    public static async Task<CommentDto> AddCommentAsync(this HttpClient client, string key, string body) =>
        await (await client.PostCommentAsync(key, body)).ReadAsync<CommentDto>(HttpStatusCode.Created);

    public static Task<HttpResponseMessage> PatchCommentAsync(this HttpClient client, Guid commentId, string body) =>
        client.PatchAsJsonAsync($"/api/v1/comments/{commentId}", new { body }, HttpAssertions.Json);

    public static async Task<CommentDto> EditCommentAsync(this HttpClient client, Guid commentId, string body) =>
        await (await client.PatchCommentAsync(commentId, body)).ReadAsync<CommentDto>();

    public static Task ClearNotificationsAsync(this TicketingApiFactory api) =>
        api.WithDbAsync(db => db.Notifications.ExecuteDeleteAsync());

    public static Task DeactivateAsync(this TicketingApiFactory api, TestUser user, TestUser by) =>
        api.WithDbAsync(async db =>
        {
            var stored = await db.Users.SingleAsync(u => u.Id == user.Id);
            stored.Deactivate(by.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync();
        });

    public static List<Guid> Ids(this IEnumerable<UserRefDto> users) => [.. users.Select(u => u.Id)];

    public static List<(NotificationKind Kind, string Summary, int EventCount)> Rows(this IEnumerable<Notification> notifications) =>
        [.. notifications.Select(n => (n.Kind, n.Summary, n.EventCount))];
}
