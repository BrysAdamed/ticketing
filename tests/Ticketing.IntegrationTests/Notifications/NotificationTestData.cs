using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Application.Notifications;
using Ticketing.Domain.Collaboration;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Notifications;

[CollectionDefinition(nameof(NotificationsCollection))]
public sealed class NotificationsCollection : ICollectionFixture<TicketingApiFactory>;

public static class NotificationTestData
{
    public static async Task<CursorPage<NotificationDto>> NotificationsAsync(this HttpClient client, string query = "") =>
        await (await client.GetAsync($"/api/v1/me/notifications{query}")).ReadAsync<CursorPage<NotificationDto>>();

    public static async Task<int> UnreadCountAsync(this HttpClient client) =>
        (await (await client.GetAsync("/api/v1/me/notifications/unread-count")).ReadAsync<UnreadNotificationCountDto>()).Count;

    public static Task<HttpResponseMessage> MarkReadAsync(this HttpClient client, object body) =>
        client.PostAsJsonAsync("/api/v1/me/notifications/read", body, HttpAssertions.Json);

    /// <summary>The stored notifications of <paramref name="recipient"/>, oldest first, hidden ones included.</summary>
    public static Task<List<Notification>> StoredNotificationsAsync(this TicketingApiFactory api, TestUser recipient) =>
        api.WithDbAsync(db => db.Notifications.AsNoTracking()
            .Where(n => n.RecipientId == recipient.Id)
            .OrderBy(n => n.CreatedAt).ThenBy(n => n.Id)
            .ToListAsync());

    public static Task<int> NotificationCountAsync(this TicketingApiFactory api) => api.WithDbAsync(db => db.Notifications.CountAsync());

    /// <summary>Moves every stored notification back in time, as if <paramref name="age"/> had passed since it was created.</summary>
    public static Task AgeNotificationsAsync(this TicketingApiFactory api, TimeSpan age) =>
        api.WithDbAsync(db => db.Notifications.ExecuteUpdateAsync(s => s
            .SetProperty(n => n.CreatedAt, n => n.CreatedAt - age)
            .SetProperty(n => n.UpdatedAt, n => n.UpdatedAt - age)));

    public static List<(NotificationKind Kind, string Summary)> Headlines(this IEnumerable<Notification> notifications) =>
        [.. notifications.Select(n => (n.Kind, n.Summary))];
}
