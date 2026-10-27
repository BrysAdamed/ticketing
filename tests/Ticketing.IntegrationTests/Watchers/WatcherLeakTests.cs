using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Search;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Search;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Watchers;

/// <summary>Spec 10 and I-32: watcher lists, the Watching filter and My work never reveal private projects or people without access.</summary>
[Collection(nameof(WatchersCollection))]
public sealed class WatcherLeakTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Private_tickets_are_not_found_for_outsiders_on_every_watcher_route()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Secret");
        var outsider = await api.CreateUserAsync();
        var browser = await api.LoginAsync(outsider);
        var token = await api.CreatePatClientAsync(outsider);

        // Act
        var responses = new[]
        {
            await browser.GetAsync("/api/v1/tickets/WEB-1/watchers", _ct),
            await browser.PutAsync("/api/v1/tickets/WEB-1/watchers/me", null, _ct),
            await browser.DeleteAsync("/api/v1/tickets/WEB-1/watchers/me", _ct),
            await token.PutAsync("/api/v1/tickets/WEB-1/watchers/me", null, _ct),
        };

        // Assert
        foreach (var response in responses)
            await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, "ticket.notFound");
        Assert.Equal([world.Owner.Id], await api.WithDbAsync(db => db.TicketWatchers.Select(w => w.UserId).ToListAsync(_ct)));
    }

    [Fact]
    public async Task A_watcher_who_loses_access_is_hidden_and_shown_again_when_access_returns()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "Membership");
        await world.ViewerClient.WatchAsync("WEB-1");

        // Act
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/WEB/members/{world.Viewer.Id}", _ct)).EnsureSuccessStatusCode();
        var whileRemoved = await world.OwnerClient.WatchersAsync("WEB-1");
        var stored = await api.StoredWatcherIdsAsync(ticket.Id);
        var viewerSearch = await world.ViewerClient.SearchAsync("watching=true");
        await api.AddMemberAsync(world.ProjectId, world.Viewer, ProjectRole.Viewer);
        var afterReturn = await world.OwnerClient.WatchersAsync("WEB-1");

        // Assert
        Assert.Equal([world.Owner.Id], whileRemoved.Ids());
        Assert.Equal(1, whileRemoved.Count);
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Viewer), stored);
        Assert.Empty(viewerSearch.Items);
        Assert.Equal(2, afterReturn.Count);
    }

    [Fact]
    public async Task Deactivated_watchers_are_hidden_and_not_auto_watched()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Deactivation");
        await world.MemberClient.WatchAsync("WEB-1");

        // Act
        await api.WithDbAsync(async db =>
        {
            var member = await db.Users.SingleAsync(u => u.Id == world.Member.Id, _ct);
            member.Deactivate(world.Owner.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync(_ct);
        });
        var watchers = await world.OwnerClient.WatchersAsync("WEB-1");

        // Assert
        Assert.Equal([world.Owner.Id], watchers.Ids());
    }

    [Fact]
    public async Task Auto_watch_skips_users_who_cannot_read_the_project()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var outsider = await api.CreateUserAsync();
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "Reporter outside");

        // Act
        await api.ExecuteAsAsync(world.Owner, async sp =>
        {
            var db = sp.GetRequiredService<ITicketingDbContext>();
            var activity = sp.GetRequiredService<IActivityLog>();
            var tracked = await db.Tickets.SingleAsync(t => t.Id == ticket.Id, _ct);
            tracked.AssignTo(outsider.Id);
            activity.RecordChange(ActivityEntityType.Ticket, ticket.Id, world.ProjectId, UpdateTicket.FieldChanged, "assignee", (Guid?)null, (Guid?)outsider.Id);
            return await db.SaveChangesAsync(_ct);
        });

        // Assert
        Assert.Equal([world.Owner.Id], await api.StoredWatcherIdsAsync(ticket.Id));
    }

    [Fact]
    public async Task Watching_search_returns_only_readable_tickets()
    {
        // Arrange
        var world = await api.SeedWorldAsync("PRIV");
        await world.OwnerClient.CreateProjectAsync("PUB", ProjectVisibility.Public);
        await world.OwnerClient.CreateTicketAsync("PRIV", "Private");
        await world.OwnerClient.CreateTicketAsync("PUB", "Public");
        await world.OwnerClient.CreateTicketAsync("PUB", "Not watched");
        await world.MemberClient.WatchAsync("PRIV-1");
        await world.MemberClient.WatchAsync("PUB-1");
        await world.OwnerClient.UnwatchAsync("PUB-2");

        // Act
        var before = await world.MemberClient.SearchKeysAsync("watching=true&sort=key");
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/PRIV/members/{world.Member.Id}", _ct)).EnsureSuccessStatusCode();
        var after = await world.MemberClient.SearchKeysAsync("watching=true&sort=key");
        var ownerWatching = await world.OwnerClient.SearchKeysAsync("watching=true&sort=key");
        var notFiltered = await world.OwnerClient.SearchKeysAsync("watching=false&sort=key");
        var invalid = await world.OwnerClient.GetAsync("/api/v1/tickets/search?watching=maybe", _ct);
        var export = await (await world.MemberClient.GetAsync("/api/v1/tickets/search/export.csv?watching=true", _ct)).Content.ReadAsStringAsync(_ct);

        // Assert
        Assert.Equal(["PRIV-1", "PUB-1"], before);
        Assert.Equal(["PUB-1"], after);
        Assert.Equal(["PRIV-1", "PUB-1"], ownerWatching);
        Assert.Equal(["PRIV-1", "PUB-1", "PUB-2"], notFiltered);
        await invalid.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.Contains("PUB-1", export, StringComparison.Ordinal);
        Assert.DoesNotContain("PRIV-1", export, StringComparison.Ordinal);
    }

    [Fact]
    public async Task My_work_lists_open_watched_tickets_i_am_not_assigned_to()
    {
        // Arrange
        var world = await api.SeedWorldAsync("PRIV");
        await world.OwnerClient.CreateTicketAsync("PRIV", "Watched open");
        await world.OwnerClient.CreateTicketAsync("PRIV", "Assigned to me", extra: new { assignee = world.Member.Email });
        await world.OwnerClient.CreateTicketAsync("PRIV", "Done", extra: new { status = "Done" });
        await world.OwnerClient.CreateTicketAsync("PRIV", "Deleted");
        await world.OwnerClient.CreateTicketAsync("PRIV", "Newest");
        foreach (var key in new[] { "PRIV-1", "PRIV-3", "PRIV-4", "PRIV-5" })
            await world.MemberClient.WatchAsync(key);
        (await world.OwnerClient.DeleteAsync("/api/v1/tickets/PRIV-4", _ct)).EnsureSuccessStatusCode();
        await world.OwnerClient.PatchTicketAsync("PRIV-5", new { priority = "High" });

        // Act
        var work = await (await world.MemberClient.GetAsync("/api/v1/me/work", _ct)).ReadAsync<MyWorkDto>();
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/PRIV/members/{world.Member.Id}", _ct)).EnsureSuccessStatusCode();
        var afterRemoval = await (await world.MemberClient.GetAsync("/api/v1/me/work", _ct)).ReadAsync<MyWorkDto>();

        // Assert
        Assert.Equal(["PRIV-5", "PRIV-1"], work.Watching.Select(t => t.Key));
        Assert.Equal(["PRIV-2"], work.Projects.SelectMany(p => p.Tickets).Select(t => t.Key));
        Assert.Empty(afterRemoval.Watching);
    }

    [Fact]
    public async Task Project_readers_follow_the_access_policy()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var inactive = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var ids = await api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var priv = Project.Create("PRIV", "Private", null, ProjectVisibility.Private, owner.Id, now);
            priv.AddMember(member.Id, ProjectRole.Member, owner.Id, now);
            priv.AddMember(viewer.Id, ProjectRole.Viewer, owner.Id, now);
            priv.AddMember(inactive.Id, ProjectRole.Member, owner.Id, now);
            var pub = Project.Create("PUB", "Public", null, ProjectVisibility.Public, owner.Id, now);
            var gone = Project.Create("GONE", "Gone", null, ProjectVisibility.Public, owner.Id, now);
            gone.Archive(owner.Id, now);
            gone.Delete(owner.Id, now, "GONE");
            db.Projects.AddRange(priv, pub, gone);
            (await db.Users.SingleAsync(u => u.Id == inactive.Id, _ct)).Deactivate(admin.Id, now);
            await db.SaveChangesAsync(_ct);
            return (Private: priv.Id, Public: pub.Id, Gone: gone.Id);
        });
        var everyone = new[] { owner, member, viewer, outsider, inactive, admin }.Select(u => u.Id).ToList();

        // Act
        var readers = await api.WithDbAsync(async db => (
            Private: await ReadersAsync(db, ids.Private, everyone),
            Public: await ReadersAsync(db, ids.Public, everyone),
            Gone: await ReadersAsync(db, ids.Gone, everyone)));

        // Assert
        Assert.Equal(WatcherTestData.Sorted(owner, member, viewer, admin), readers.Private);
        Assert.Equal(WatcherTestData.Sorted(owner, member, viewer, outsider, admin), readers.Public);
        Assert.Empty(readers.Gone);
    }

    private Task<List<Guid>> ReadersAsync(ITicketingDbContext db, Guid projectId, List<Guid> among) =>
        ProjectReaders.Of(db, projectId).Where(u => among.Contains(u.Id)).Select(u => u.Id).OrderBy(id => id).ToListAsync(_ct);
}
