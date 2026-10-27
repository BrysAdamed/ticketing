using System.Net;
using System.Net.Http.Json;
using Ticketing.Domain.Collaboration;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Notifications;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Mentions;

/// <summary>D-95: who can be mentioned (active readers of the project), checked only for newly added mentions; @email normalization.</summary>
[Collection(nameof(MentionsCollection))]
public sealed class MentionValidationTests(TicketingApiFactory api)
{
    [Fact]
    public async Task Mentioning_someone_who_cannot_read_a_private_project_is_rejected()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var outsider = await api.CreateUserAsync(displayName: "Outsider Olga");
        await world.OwnerClient.CreateTicketAsync("WEB", "Private");

        // Act
        var comment = await world.OwnerClient.PostCommentAsync("WEB-1", $"Hey {outsider.Mention()}");
        var byEmail = await world.OwnerClient.PostCommentAsync("WEB-1", $"Hey @{outsider.Email}");
        var description = await world.OwnerClient.PatchAsJsonAsync("/api/v1/tickets/WEB-1", new { description = outsider.Mention() }, HttpAssertions.Json);

        // Assert
        var problem = await comment.ShouldBeProblemAsync(HttpStatusCode.BadRequest, CollaborationErrors.MentionInvalid);
        Assert.Contains("Outsider Olga", problem.GetProperty("errors").GetProperty("body")[0].GetString(), StringComparison.Ordinal);
        Assert.Equal("Only active users who can read project WEB can be mentioned.", problem.GetProperty("hint").GetString());
        await byEmail.ShouldBeProblemAsync(HttpStatusCode.BadRequest, CollaborationErrors.MentionInvalid);
        var descriptionProblem = await description.ShouldBeProblemAsync(HttpStatusCode.BadRequest, CollaborationErrors.MentionInvalid);
        Assert.True(descriptionProblem.GetProperty("errors").TryGetProperty("description", out _));
        Assert.Empty((await world.OwnerClient.GetTicketAsync("WEB-1")).Comments!);
        Assert.Equal(0, await api.NotificationCountAsync());
    }

    [Fact]
    public async Task Inactive_and_unknown_users_cannot_be_mentioned()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await api.DeactivateAsync(world.Member, world.Owner);
        await world.OwnerClient.CreateTicketAsync("WEB", "Gone");

        // Act
        var inactive = await world.OwnerClient.PostCommentAsync("WEB-1", world.Member.Mention());
        var unknown = await world.OwnerClient.PostCommentAsync("WEB-1", Domain.Collaboration.Mentions.Format(Guid.CreateVersion7(), "Ghost"));
        var create = await world.OwnerClient.PostAsJsonAsync(
            "/api/v1/projects/WEB/tickets", new { title = "New", type = "Bug", description = world.Member.Mention() }, HttpAssertions.Json);

        // Assert
        await inactive.ShouldBeProblemAsync(HttpStatusCode.BadRequest, CollaborationErrors.MentionInvalid);
        await unknown.ShouldBeProblemAsync(HttpStatusCode.BadRequest, CollaborationErrors.MentionInvalid);
        await create.ShouldBeProblemAsync(HttpStatusCode.BadRequest, CollaborationErrors.MentionInvalid);
    }

    [Fact]
    public async Task A_viewer_of_a_private_project_can_be_mentioned()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Viewers welcome");

        // Act
        var comment = await world.MemberClient.AddCommentAsync("WEB-1", $"cc {world.Viewer.Mention()}");

        // Assert
        Assert.Equal([world.Viewer.Id], comment.Mentions.Ids());
        Assert.Single(await api.StoredNotificationsAsync(world.Viewer));
    }

    [Fact]
    public async Task An_existing_mention_of_a_user_who_lost_access_does_not_block_an_edit()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Lost access", extra: new { description = $"Ask {world.Member.Mention()}" });
        var comment = await world.OwnerClient.AddCommentAsync("WEB-1", $"Ping {world.Member.Mention()}");
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/WEB/members/{world.Member.Id}")).EnsureSuccessStatusCode();

        // Act
        var edited = await world.OwnerClient.EditCommentAsync(comment.Id, $"Ping {world.Member.Mention()} (left the team)");
        var ticket = await world.OwnerClient.PatchTicketAsync("WEB-1", new { description = $"Ask {world.Member.Mention()} or the owner" });

        // Assert
        Assert.Empty(edited.Mentions);
        Assert.Empty(ticket.Mentions);
        Assert.Contains($"user:{world.Member.Id}", edited.Body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task At_email_is_stored_as_a_mention_with_the_current_name_and_unknown_emails_stay_text()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Emails");

        // Act
        var comment = await world.OwnerClient.AddCommentAsync(
            "WEB-1", $"Thanks @{world.Member.Email.ToUpperInvariant()}! Also @nobody@example.com and `@{world.Viewer.Email}`.");

        // Assert
        Assert.Equal(
            $"Thanks {world.Member.Mention()}! Also @nobody@example.com and `@{world.Viewer.Email}`.", comment.Body);
        Assert.Equal([world.Member.Id], comment.Mentions.Ids());
        Assert.Single(await api.StoredNotificationsAsync(world.Member));
        Assert.Empty(await api.StoredNotificationsAsync(world.Viewer));
    }

    [Fact]
    public async Task New_mentions_are_written_with_the_current_display_name()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Names");

        // Act
        var comment = await world.OwnerClient.AddCommentAsync("WEB-1", $"@[Someone Else](user:{world.Member.Id})");

        // Assert
        Assert.Equal(world.Member.Mention(), comment.Body);
    }
}
