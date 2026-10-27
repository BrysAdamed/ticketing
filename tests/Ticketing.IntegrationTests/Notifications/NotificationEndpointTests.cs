using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Notifications;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Tokens;
using Ticketing.Infrastructure.Maintenance;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Notifications;

[Collection(nameof(NotificationsCollection))]
public sealed class NotificationEndpointTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_list_is_newest_first_with_cursor_paging_and_an_unread_filter()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        for (var i = 1; i <= 5; i++)
            await world.OwnerClient.CreateTicketAsync("WEB", $"Task {i}", extra: new { assignee = world.Member.Email });
        var all = await world.MemberClient.NotificationsAsync();
        (await world.MemberClient.MarkReadAsync(new { ids = new[] { all.Items[0].Id, all.Items[3].Id } })).EnsureSuccessStatusCode();

        // Act
        var first = await world.MemberClient.NotificationsAsync("?limit=2");
        var second = await world.MemberClient.NotificationsAsync($"?limit=2&cursor={first.NextCursor}");
        var third = await world.MemberClient.NotificationsAsync($"?limit=2&cursor={second.NextCursor}");
        var unread = await world.MemberClient.NotificationsAsync("?unread=true");
        var badCursor = await world.MemberClient.GetAsync("/api/v1/me/notifications?cursor=nope", _ct);

        // Assert
        Assert.Equal(["WEB-5", "WEB-4", "WEB-3", "WEB-2", "WEB-1"], all.Items.Select(n => n.Ticket!.Key));
        Assert.Equal(all.Items.Select(n => n.Id), first.Items.Concat(second.Items).Concat(third.Items).Select(n => n.Id));
        Assert.Null(third.NextCursor);
        Assert.Equal(["WEB-4", "WEB-3", "WEB-1"], unread.Items.Select(n => n.Ticket!.Key));
        Assert.Equal(3, await world.MemberClient.UnreadCountAsync());
        await badCursor.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "cursor.invalid");
    }

    [Fact]
    public async Task A_notification_serializes_as_the_documented_contract()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Contract", extra: new { assignee = world.Member.Email });

        // Act
        var json = JsonDocument.Parse(await world.MemberClient.GetStringAsync("/api/v1/me/notifications", _ct)).RootElement;

        // Assert
        var item = json.GetProperty("items")[0];
        Assert.Equal(
            ["id", "kind", "summary", "eventCount", "actor", "projectKey", "ticket", "regression", "doc", "url", "createdAt", "updatedAt", "readAt"],
            item.EnumerateObject().Select(p => p.Name));
        Assert.Equal("Assigned", item.GetProperty("kind").GetString());
        Assert.Equal(world.Owner.Email, item.GetProperty("actor").GetProperty("email").GetString());
        Assert.Equal("WEB", item.GetProperty("projectKey").GetString());
        Assert.Equal("Contract", item.GetProperty("ticket").GetProperty("title").GetString());
        Assert.False(item.GetProperty("ticket").GetProperty("deleted").GetBoolean());
        Assert.Equal(JsonValueKind.Null, item.GetProperty("regression").ValueKind);
        Assert.Equal(JsonValueKind.Null, item.GetProperty("doc").ValueKind);
        Assert.Equal("/tickets/WEB-1", item.GetProperty("url").GetString());
        Assert.Equal(JsonValueKind.Null, item.GetProperty("readAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("nextCursor").ValueKind);
    }

    [Fact]
    public async Task Mark_read_marks_one_or_all_and_returns_the_unread_count()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        for (var i = 1; i <= 3; i++)
            await world.OwnerClient.CreateTicketAsync("WEB", $"Task {i}", extra: new { assignee = world.Member.Email });
        var items = (await world.MemberClient.NotificationsAsync()).Items;

        // Act
        var one = await (await world.MemberClient.MarkReadAsync(new { ids = new[] { items[1].Id } })).ReadAsync<MarkNotificationsReadResult>();
        var again = await (await world.MemberClient.MarkReadAsync(new { ids = new[] { items[1].Id } })).ReadAsync<MarkNotificationsReadResult>();
        var readAt = (await api.StoredNotificationsAsync(world.Member)).Single(n => n.Id == items[1].Id).ReadAt;
        var all = await (await world.MemberClient.MarkReadAsync(new { all = true })).ReadAsync<MarkNotificationsReadResult>();

        // Assert
        Assert.Equal((2, 2, 0), (one.UnreadCount, again.UnreadCount, all.UnreadCount));
        Assert.Equal(readAt, (await api.StoredNotificationsAsync(world.Member)).Single(n => n.Id == items[1].Id).ReadAt);
        Assert.All(await api.StoredNotificationsAsync(world.Member), n => Assert.NotNull(n.ReadAt));
        Assert.All((await world.MemberClient.NotificationsAsync()).Items, n => Assert.NotNull(n.ReadAt));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"ids\":[]}")]
    [InlineData("{\"all\":false}")]
    [InlineData("{\"all\":true,\"ids\":[\"0199f0c4-0000-7000-8000-000000000001\"]}")]
    public async Task Mark_read_needs_either_ids_or_all(string body)
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);

        // Act
        var response = await client.PostAsync("/api/v1/me/notifications/read", new StringContent(body, System.Text.Encoding.UTF8, "application/json"), _ct);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.True(problem.GetProperty("errors").TryGetProperty("ids", out _));
    }

    [Fact]
    public async Task Mark_read_accepts_at_most_100_ids()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await client.MarkReadAsync(new { ids = Enumerable.Range(0, 101).Select(_ => Guid.NewGuid()).ToArray() });

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
    }

    [Fact]
    public async Task Read_only_tokens_can_list_but_not_mark_read()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Token", extra: new { assignee = world.Member.Email });
        var token = await api.CreatePatClientAsync(world.Member, PatScope.ReadOnly);

        // Act
        var listed = await token.NotificationsAsync();
        var count = await token.UnreadCountAsync();
        var marked = await token.MarkReadAsync(new { all = true });

        // Assert
        Assert.Single(listed.Items);
        Assert.Equal(1, count);
        await marked.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "pat.readOnlyScope");
        Assert.Equal(1, await world.MemberClient.UnreadCountAsync());
    }

    [Fact]
    public async Task Notifications_need_a_signed_in_user()
    {
        // Arrange
        var anonymous = api.CreateBrowserClient();

        // Act
        var responses = new[]
        {
            await anonymous.GetAsync("/api/v1/me/notifications", _ct),
            await anonymous.GetAsync("/api/v1/me/notifications/unread-count", _ct),
        };

        // Assert
        foreach (var response in responses)
            await response.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.unauthenticated");
    }

    [Fact]
    public async Task Retention_purges_notifications_older_than_90_days()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Old", extra: new { assignee = world.Member.Email });
        await api.AgeNotificationsAsync(TimeSpan.FromDays(91));
        await world.OwnerClient.CreateTicketAsync("WEB", "Recent", extra: new { assignee = world.Member.Email });
        await api.WithDbAsync(db => db.Notifications
            .Where(n => n.CreatedAt > DateTimeOffset.UtcNow.AddDays(-1))
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.CreatedAt, n => n.CreatedAt - TimeSpan.FromDays(89)), _ct));

        // Act
        RetentionResult result;
        await using (var scope = api.Services.CreateAsyncScope())
            result = await scope.ServiceProvider.GetRequiredService<DataRetention>().PurgeAsync(_ct);

        // Assert
        Assert.Equal(1, result.PurgedNotifications);
        Assert.Equal(["Recent"], (await world.MemberClient.NotificationsAsync()).Items.Select(n => n.Ticket!.Title));
        Assert.Equal([NotificationKind.Assigned], (await api.StoredNotificationsAsync(world.Member)).Select(n => n.Kind));
    }
}
