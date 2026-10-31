using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Notifications;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Mentions;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Notifications;

/// <summary>TKT-36, D-160: muted kinds and projects silence notifications at save time; mentions and assignments survive a project mute.</summary>
[Collection(nameof(NotificationsCollection))]
public sealed class NotificationPreferenceTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Nothing_is_muted_by_default()
    {
        // Arrange
        var world = await api.SeedWorldAsync();

        // Act
        var preferences = await world.MemberClient.PreferencesAsync();

        // Assert
        Assert.Equal(Enum.GetValues<NotificationKind>(), preferences.Kinds.Select(k => k.Kind));
        Assert.All(preferences.Kinds, k => Assert.False(k.Muted));
        Assert.Equal(
            [NotificationKind.Assigned, NotificationKind.Mentioned, NotificationKind.RegressionItemAssigned],
            preferences.Kinds.Where(k => k.Direct).Select(k => k.Kind));
        Assert.Empty(preferences.MutedProjects);
        Assert.Null(preferences.UpdatedAt);
    }

    [Fact]
    public async Task A_muted_kind_stops_notifying_and_unmuting_brings_it_back()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Chatty");
        await world.MemberClient.WatchAsync("WEB-1");

        // Act
        var muted = await (await world.MemberClient.UpdatePreferencesAsync(new { muteKinds = new[] { "Commented", "StatusChanged" } }))
            .ReadAsync<NotificationPreferencesDto>();
        await world.OwnerClient.CommentAsync("WEB-1");
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { status = "InProgress" });
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { priority = "Highest" });
        var whileMuted = await api.StoredNotificationsAsync(world.Member);
        await world.MemberClient.UpdatePreferencesAsync(new { unmuteKinds = new[] { "Commented" } });
        await api.WithDbAsync(db => db.Notifications.ExecuteDeleteAsync());
        await world.OwnerClient.CommentAsync("WEB-1");
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { status = "Review" });

        // Assert
        Assert.Equal([NotificationKind.Commented, NotificationKind.StatusChanged], muted.Kinds.Where(k => k.Muted).Select(k => k.Kind));
        Assert.NotNull(muted.UpdatedAt);
        Assert.Equal([NotificationKind.PriorityRaised], whileMuted.Select(n => n.Kind));
        Assert.Equal([NotificationKind.Commented], (await api.StoredNotificationsAsync(world.Member)).Select(n => n.Kind));
    }

    [Fact]
    public async Task A_muted_project_silences_activity_but_not_mentions_or_assignments()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateProjectAsync("OPS", ProjectVisibility.Public);
        await world.OwnerClient.CreateTicketAsync("WEB", "Muted project");
        await world.OwnerClient.CreateTicketAsync("OPS", "Loud project");
        await world.MemberClient.WatchAsync("WEB-1");
        await world.MemberClient.WatchAsync("OPS-1");

        // Act
        var muted = await (await world.MemberClient.UpdatePreferencesAsync(new { muteProjects = new[] { "web" } }))
            .ReadAsync<NotificationPreferencesDto>();
        await world.OwnerClient.CommentAsync("WEB-1");
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { status = "InProgress" });
        await world.OwnerClient.CommentAsync("OPS-1");
        await world.OwnerClient.AddCommentAsync("WEB-1", $"Your call, {world.Member.Mention()}");
        await world.OwnerClient.CreateTicketAsync("WEB", "For you", extra: new { assignee = world.Member.Email });

        // Assert
        Assert.Equal(["WEB"], muted.MutedProjects.Select(p => p.Key));
        var stored = await api.StoredNotificationsAsync(world.Member);
        var opsTicket = await api.WithDbAsync(db => db.Tickets.Where(t => t.Title == "Loud project").Select(t => t.Id).SingleAsync());
        Assert.Equal(
            [(NotificationKind.Commented, true), (NotificationKind.Mentioned, false), (NotificationKind.Assigned, false)],
            stored.Select(n => (n.Kind, n.TicketId == opsTicket)));
    }

    [Fact]
    public async Task Muting_a_direct_kind_silences_it_everywhere()
    {
        // Arrange
        var world = await api.SeedWorldAsync();

        // Act
        await world.MemberClient.UpdatePreferencesAsync(new { muteKinds = new[] { "Assigned" } });
        await world.OwnerClient.CreateTicketAsync("WEB", "Quietly yours", extra: new { assignee = world.Member.Email });
        await world.OwnerClient.CreateTicketAsync("WEB", "Reassigned later", extra: new { assignee = world.Owner.Email });
        await world.OwnerClient.PatchTicketAsync("WEB-2", new { assignee = world.Member.Email });

        // Assert
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
    }

    [Fact]
    public async Task Preferences_are_per_user()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Shared");
        await world.MemberClient.WatchAsync("WEB-1");
        await world.ViewerClient.WatchAsync("WEB-1");
        await world.MemberClient.UpdatePreferencesAsync(new { muteProjects = new[] { "WEB" } });

        // Act
        await world.OwnerClient.CommentAsync("WEB-1");

        // Assert
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
        Assert.Single(await api.StoredNotificationsAsync(world.Viewer));
        Assert.Empty((await world.ViewerClient.PreferencesAsync()).MutedProjects);
    }

    [Fact]
    public async Task Repeating_a_change_is_harmless_and_unmuting_what_is_not_muted_changes_nothing()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.MemberClient.UpdatePreferencesAsync(new { muteKinds = new[] { "Moved" }, muteProjects = new[] { "WEB" } });

        // Act
        var again = await (await world.MemberClient.UpdatePreferencesAsync(new
        {
            muteKinds = new[] { "Moved", "Moved" },
            unmuteKinds = new[] { "Deleted" },
            muteProjects = new[] { "WEB", world.ProjectId.ToString() },
        })).ReadAsync<NotificationPreferencesDto>();
        var empty = await (await world.MemberClient.UpdatePreferencesAsync(new { })).ReadAsync<NotificationPreferencesDto>();
        var unmuted = await (await world.MemberClient.UpdatePreferencesAsync(new { unmuteKinds = new[] { "Moved" }, unmuteProjects = new[] { "WEB" } }))
            .ReadAsync<NotificationPreferencesDto>();

        // Assert
        Assert.Equal([NotificationKind.Moved], again.Kinds.Where(k => k.Muted).Select(k => k.Kind));
        Assert.Equal(["WEB"], again.MutedProjects.Select(p => p.Key));
        Assert.Equal(again.Kinds, empty.Kinds);
        Assert.All(unmuted.Kinds, k => Assert.False(k.Muted));
        Assert.Empty(unmuted.MutedProjects);
        var stored = await api.WithDbAsync(db => db.NotificationPreferences.AsNoTracking().SingleAsync(p => p.UserId == world.Member.Id));
        Assert.Equal((0, 0), (stored.MutedKinds.Count, stored.MutedProjectIds.Count));
    }

    [Fact]
    public async Task Invalid_changes_are_rejected_and_change_nothing()
    {
        // Arrange
        var world = await api.SeedWorldAsync();

        // Act
        var both = await world.MemberClient.UpdatePreferencesAsync(new { muteKinds = new[] { "Moved" }, unmuteKinds = new[] { "Moved" } });
        var bothProjects = await world.MemberClient.UpdatePreferencesAsync(new { muteProjects = new[] { "WEB" }, unmuteProjects = new[] { world.ProjectId.ToString() } });
        var unknownKind = await world.MemberClient.UpdatePreferencesAsync(new { muteKinds = new[] { "Everything" } });
        var blank = await world.MemberClient.UpdatePreferencesAsync(new { muteProjects = new[] { " " } });
        var tooMany = await world.MemberClient.UpdatePreferencesAsync(new { muteProjects = Enumerable.Range(0, 51).Select(i => $"P{i}").ToArray() });

        // Assert
        await both.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        await bothProjects.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.Equal(HttpStatusCode.BadRequest, unknownKind.StatusCode);
        await blank.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        await tooMany.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.Equal(0, await api.WithDbAsync(db => db.NotificationPreferences.CountAsync()));
    }

    [Fact]
    public async Task At_most_200_projects_can_be_muted()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.MemberClient.UpdatePreferencesAsync(new { muteKinds = new[] { "Moved" } });
        var others = Enumerable.Range(0, NotificationPreferences.MaxMutedProjects).Select(_ => Guid.CreateVersion7()).ToArray();
        await api.WithDbAsync(db => db.Database.ExecuteSqlAsync(
            $"UPDATE notification_preferences SET muted_project_ids = {others} WHERE user_id = {world.Member.Id}"));

        // Act
        var response = await world.MemberClient.UpdatePreferencesAsync(new { muteProjects = new[] { "WEB" } });
        var unmuteStillWorks = await world.MemberClient.UpdatePreferencesAsync(new { unmuteKinds = new[] { "Moved" } });

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, CollaborationErrors.MutedProjectLimit);
        await unmuteStillWorks.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Private_projects_you_cannot_read_answer_not_found_and_are_not_stored()
    {
        // Arrange
        var world = await api.SeedWorldAsync("PRIV");
        var outsider = await api.CreateUserAsync();
        var outsiderClient = await api.LoginAsync(outsider);

        // Act
        var byKey = await outsiderClient.UpdatePreferencesAsync(new { muteProjects = new[] { "PRIV" } });
        var byId = await outsiderClient.UpdatePreferencesAsync(new { unmuteProjects = new[] { world.ProjectId.ToString() } });
        var unknown = await outsiderClient.UpdatePreferencesAsync(new { muteProjects = new[] { "NOPE" } });

        // Assert
        await byKey.ShouldBeProblemAsync(HttpStatusCode.NotFound, "project.notFound");
        await byId.ShouldBeProblemAsync(HttpStatusCode.NotFound, "project.notFound");
        await unknown.ShouldBeProblemAsync(HttpStatusCode.NotFound, "project.notFound");
        Assert.Equal(0, await api.WithDbAsync(db => db.NotificationPreferences.CountAsync()));
    }

    [Fact]
    public async Task A_muted_project_you_lost_access_to_is_hidden_and_returns_with_access()
    {
        // Arrange
        var world = await api.SeedWorldAsync("PRIV");
        await world.MemberClient.UpdatePreferencesAsync(new { muteProjects = new[] { "PRIV" } });

        // Act
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/PRIV/members/{world.Member.Id}", _ct)).EnsureSuccessStatusCode();
        var removed = await world.MemberClient.PreferencesAsync();
        await api.AddMemberAsync(world.ProjectId, world.Member, ProjectRole.Viewer);
        var restored = await world.MemberClient.PreferencesAsync();

        // Assert
        Assert.Empty(removed.MutedProjects);
        Assert.Equal(["PRIV"], restored.MutedProjects.Select(p => p.Key));
    }

    [Fact]
    public async Task Tokens_read_preferences_and_only_write_scoped_ones_change_them()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var readOnly = await api.CreatePatClientAsync(world.Member, PatScope.ReadOnly);
        var readWrite = await api.CreatePatClientAsync(world.Member);

        // Act
        var read = await readOnly.GetAsync("/api/v1/me/notification-preferences", _ct);
        var denied = await readOnly.UpdatePreferencesAsync(new { muteKinds = new[] { "Moved" } });
        var allowed = await readWrite.UpdatePreferencesAsync(new { muteKinds = new[] { "Moved" } });

        // Assert
        await read.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await denied.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "pat.readOnlyScope");
        await allowed.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }
}

public static class NotificationPreferenceTestData
{
    public static async Task<NotificationPreferencesDto> PreferencesAsync(this HttpClient client) =>
        await (await client.GetAsync("/api/v1/me/notification-preferences")).ReadAsync<NotificationPreferencesDto>();

    public static Task<HttpResponseMessage> UpdatePreferencesAsync(this HttpClient client, object body) =>
        client.PatchAsJsonAsync("/api/v1/me/notification-preferences", body, HttpAssertions.Json);
}
