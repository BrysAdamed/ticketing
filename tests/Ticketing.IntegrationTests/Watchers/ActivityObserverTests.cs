using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Comments;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Watchers;

/// <summary>D-93: collaboration rules run inside the save that records the activity.</summary>
[Collection(nameof(WatchersCollection))]
public sealed class ActivityObserverTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Synchronous_saves_with_pending_activity_are_rejected()
    {
        // Arrange
        var entry = ActivityEntry.Create(ActivityEntityType.Ticket, Guid.NewGuid(), Guid.NewGuid(), null, null, DateTimeOffset.UtcNow, CreateTicket.Action);

        // Act
        var error = await api.WithDbAsync(db =>
        {
            db.ActivityEntries.Add(entry);
            return Task.FromResult(Record.Exception(() => db.SaveChanges()));
        });

        // Assert
        Assert.IsType<InvalidOperationException>(error);
        Assert.Equal(0, await api.WithDbAsync(db => db.ActivityEntries.CountAsync(a => a.Id == entry.Id, _ct)));
    }

    [Fact]
    public async Task Activity_about_unknown_tickets_or_without_an_actor_derives_nothing()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "System comment");
        var now = DateTimeOffset.UtcNow;

        // Act
        await api.WithDbAsync(db =>
        {
            db.ActivityEntries.Add(ActivityEntry.Create(ActivityEntityType.Ticket, Guid.NewGuid(), world.ProjectId, null, null, now, CreateTicket.Action));
            db.ActivityEntries.Add(ActivityEntry.Create(
                ActivityEntityType.Ticket, ticket.Id, world.ProjectId, null, null, now, AddComment.Action, newValueJson: $"{{\"commentId\":\"{Guid.NewGuid()}\"}}"));
            return db.SaveChangesAsync(_ct);
        });

        // Assert
        Assert.Equal([world.Owner.Id], await api.StoredWatcherIdsAsync(ticket.Id));
    }

    [Fact]
    public async Task A_failed_write_adds_no_watchers()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Epic", "Epic");
        await world.OwnerClient.CreateTicketAsync("WEB", "Other epic", "Epic");

        // Act
        var response = await world.MemberClient.PatchAsJsonAsync(
            "/api/v1/tickets/WEB-1", new { assignee = world.Member.Email, parentKey = "WEB-2" }, HttpAssertions.Json, _ct);

        // Assert
        Assert.False(response.IsSuccessStatusCode);
        Assert.Equal(0, await api.WithDbAsync(db => db.TicketWatchers.CountAsync(w => w.UserId == world.Member.Id, _ct)));
    }
}
