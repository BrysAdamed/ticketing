using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Watchers;

[Collection(nameof(WatchersCollection))]
public sealed class WatcherEndpointTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Reporter_and_assignee_watch_a_new_ticket()
    {
        // Arrange
        var world = await api.SeedWorldAsync();

        // Act
        await world.OwnerClient.CreateTicketAsync("WEB", "Login fails", extra: new { assignee = world.Member.Email });
        var asOwner = await world.OwnerClient.WatchersAsync("WEB-1");
        var asViewer = await world.ViewerClient.WatchersAsync("web-1");

        // Assert
        Assert.Equal(2, asOwner.Count);
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), asOwner.Ids().OrderBy(id => id));
        Assert.True(asOwner.Watching);
        Assert.False(asViewer.Watching);
        Assert.Equal(asOwner.Users, asViewer.Users);
    }

    [Fact]
    public async Task Watchers_are_ordered_by_display_name_and_carry_the_user_ref()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Ordering");
        await world.ViewerClient.WatchAsync("WEB-1");

        // Act
        var watchers = await world.MemberClient.WatchAsync("WEB-1");

        // Assert
        Assert.Equal([world.Member.DisplayName, world.Owner.DisplayName, world.Viewer.DisplayName], watchers.Users.Select(u => u.DisplayName));
        Assert.All(watchers.Users, u => Assert.True(u.IsActive));
        Assert.Equal(world.Member.Email, watchers.Users[0].Email);
    }

    [Fact]
    public async Task Watch_and_unwatch_are_idempotent()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "Twice");

        // Act
        var first = await world.ViewerClient.WatchAsync("WEB-1");
        var second = await world.ViewerClient.WatchAsync("WEB-1");
        var unwatched = await world.ViewerClient.UnwatchAsync("WEB-1");
        var again = await world.ViewerClient.UnwatchAsync("WEB-1");

        // Assert
        Assert.Equal((2, true), (first.Count, first.Watching));
        Assert.Equal((2, true), (second.Count, second.Watching));
        Assert.Equal(first.Ids(), second.Ids());
        Assert.Equal((1, false), (unwatched.Count, unwatched.Watching));
        Assert.Equal(unwatched.Ids(), again.Ids());
        Assert.Equal([world.Owner.Id], await api.StoredWatcherIdsAsync(ticket.Id));
    }

    [Fact]
    public async Task New_assignees_and_commenters_start_watching_and_unwatching_holds_until_the_next_trigger()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "Triggers");
        await world.OwnerClient.UnwatchAsync("WEB-1");

        // Act
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { title = "Renamed", priority = "High" });
        var afterEdit = await api.StoredWatcherIdsAsync(ticket.Id);
        await world.MemberClient.CommentAsync("WEB-1");
        await world.MemberClient.UnwatchAsync("WEB-1");
        await world.MemberClient.CommentAsync("WEB-1", "Second thoughts");
        await world.MemberClient.PatchTicketAsync("WEB-1", new { assignee = world.Owner.Email });
        var watchers = await world.OwnerClient.WatchersAsync("WEB-1");

        // Assert
        Assert.Empty(afterEdit);
        Assert.True(watchers.Watching);
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), watchers.Ids().OrderBy(id => id));
    }

    [Fact]
    public async Task Reassigning_adds_each_new_assignee_and_keeps_the_previous_one()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "Hand over", extra: new { assignee = world.Owner.Email });

        // Act
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { assignee = world.Member.Id });
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { assignee = (string?)null });

        // Assert
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), await api.StoredWatcherIdsAsync(ticket.Id));
    }

    [Fact]
    public async Task Batch_creation_makes_reporter_and_assignee_watch_every_ticket()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var items = Enumerable.Range(1, 50).Select(i => new { title = $"Ticket {i}", type = "Technical", assignee = world.Member.Email }).ToArray();

        // Act
        var response = await world.OwnerClient.PostAsJsonAsync("/api/v1/projects/WEB/tickets/batch", new { tickets = items }, _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.Created);
        var perTicket = await api.WithDbAsync(db => db.TicketWatchers.GroupBy(w => w.TicketId).Select(g => g.Count()).ToListAsync(_ct));
        Assert.Equal(50, perTicket.Count);
        Assert.All(perTicket, count => Assert.Equal(2, count));
    }

    [Fact]
    public async Task Idempotent_create_replays_do_not_duplicate_watchers()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var request = () =>
        {
            var message = new HttpRequestMessage(HttpMethod.Post, "/api/v1/projects/WEB/tickets") { Content = JsonContent.Create(new { title = "Once", type = "Bug" }) };
            message.Headers.Add("Idempotency-Key", "create-once");
            return message;
        };

        // Act
        var first = await (await world.OwnerClient.SendAsync(request(), _ct)).ReadAsync<TicketSummaryDto>(HttpStatusCode.Created);
        var replay = await (await world.OwnerClient.SendAsync(request(), _ct)).ReadAsync<TicketSummaryDto>(HttpStatusCode.Created);

        // Assert
        Assert.Equal(first.Id, replay.Id);
        Assert.Equal([world.Owner.Id], await api.StoredWatcherIdsAsync(first.Id));
    }

    [Fact]
    public async Task Read_access_is_enough_to_watch_including_viewers_admins_public_projects_and_archived_projects()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var outsider = await api.LoginAsync(await api.CreateUserAsync());
        await world.OwnerClient.CreateProjectAsync("PUB", ProjectVisibility.Public);
        await world.OwnerClient.CreateTicketAsync("PUB", "Public");
        await world.OwnerClient.CreateTicketAsync("WEB", "Private");
        (await world.OwnerClient.PostAsync("/api/v1/projects/WEB/archive", null, _ct)).EnsureSuccessStatusCode();

        // Act
        var viewer = await world.ViewerClient.WatchAsync("WEB-1");
        var member = await world.MemberClient.WatchAsync("WEB-1");
        var asAdmin = await admin.WatchAsync("WEB-1");
        var publicTicket = await outsider.WatchAsync("PUB-1");

        // Assert
        Assert.Equal((3, true), (member.Count, member.Watching));
        Assert.True(viewer.Watching);
        Assert.Equal((4, true), (asAdmin.Count, asAdmin.Watching));
        Assert.Equal((2, true), (publicTicket.Count, publicTicket.Watching));
    }

    [Fact]
    public async Task Read_only_tokens_can_list_but_not_watch_or_unwatch()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Tokens");
        var readOnly = await api.CreatePatClientAsync(world.Member, PatScope.ReadOnly);
        var readWrite = await api.CreatePatClientAsync(world.Viewer);

        // Act
        var list = await readOnly.GetAsync("/api/v1/tickets/WEB-1/watchers", _ct);
        var watch = await readOnly.PutAsync("/api/v1/tickets/WEB-1/watchers/me", null, _ct);
        var unwatch = await readOnly.DeleteAsync("/api/v1/tickets/WEB-1/watchers/me", _ct);
        var withWriteToken = await readWrite.WatchAsync("WEB-1");

        // Assert
        await list.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await watch.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "pat.readOnlyScope");
        await unwatch.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "pat.readOnlyScope");
        Assert.True(withWriteToken.Watching);
    }

    [Fact]
    public async Task Deleted_and_unknown_tickets_are_not_found()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Gone");
        (await world.OwnerClient.DeleteAsync("/api/v1/tickets/WEB-1", _ct)).EnsureSuccessStatusCode();

        // Act
        var deleted = await world.OwnerClient.PutAsync("/api/v1/tickets/WEB-1/watchers/me", null, _ct);
        var unknown = await world.OwnerClient.GetAsync("/api/v1/tickets/WEB-99/watchers", _ct);

        // Assert
        await deleted.ShouldBeProblemAsync(HttpStatusCode.NotFound, "ticket.deleted");
        await unknown.ShouldBeProblemAsync(HttpStatusCode.NotFound, "ticket.notFound");
    }

    [Fact]
    public async Task Get_ticket_includes_watchers_by_default_and_on_request()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Included");

        // Act
        var all = await world.ViewerClient.GetTicketAsync("WEB-1");
        var onlyWatchers = await (await world.ViewerClient.GetAsync("/api/v1/tickets/WEB-1?include=watchers", _ct)).ReadAsync<TicketDto>();
        var onlyLinks = await (await world.ViewerClient.GetAsync("/api/v1/tickets/WEB-1?include=links", _ct)).ReadAsync<TicketDto>();
        var patched = await world.OwnerClient.PatchTicketAsync("WEB-1", new { title = "Patched" });

        // Assert
        Assert.Equal((1, false), (all.Watchers!.Count, all.Watchers.Watching));
        Assert.Equal([world.Owner.Id], onlyWatchers.Watchers!.Ids());
        Assert.Null(onlyWatchers.Links);
        Assert.Null(onlyLinks.Watchers);
        Assert.Null(patched.Watchers);
    }
}
