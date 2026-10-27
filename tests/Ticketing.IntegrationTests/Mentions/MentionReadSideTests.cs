using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Mentions;

/// <summary>D-95: <c>mentions</c> on tickets and comments lists only active users who can read the project, resolved at read time.</summary>
[Collection(nameof(MentionsCollection))]
public sealed class MentionReadSideTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Ticket_and_comments_expose_mentioned_readers_in_order_of_first_mention()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync(
            "WEB", "Read side", extra: new { description = $"{world.Viewer.Mention()} then {world.Member.Mention()} and {world.Viewer.Mention()}" });
        await world.OwnerClient.AddCommentAsync("WEB-1", $"cc {world.Member.Mention()}");
        await world.OwnerClient.AddCommentAsync("WEB-1", "no mentions");

        // Act
        var ticket = await world.ViewerClient.GetTicketAsync("WEB-1");
        var page = await (await world.ViewerClient.GetAsync("/api/v1/tickets/WEB-1/comments", _ct)).ReadAsync<CursorPage<CommentDto>>();

        // Assert
        Assert.Equal([world.Viewer.Id, world.Member.Id], ticket.Mentions.Ids());
        Assert.Equal("Member Mia", ticket.Mentions[1].DisplayName);
        Assert.Equal(2, ticket.Comments!.Count);
        Assert.Equal([world.Member.Id], ticket.Comments[0].Mentions.Ids());
        Assert.Empty(ticket.Comments[1].Mentions);
        Assert.Equal([world.Member.Id], page.Items[0].Mentions.Ids());
        Assert.Empty(page.Items[1].Mentions);
    }

    [Fact]
    public async Task Mentions_of_users_who_were_deactivated_or_lost_access_are_left_out()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync(
            "WEB", "Hidden", extra: new { description = $"{world.Member.Mention()} {world.Viewer.Mention()}" });
        await world.OwnerClient.AddCommentAsync("WEB-1", $"{world.Member.Mention()} {world.Viewer.Mention()}");

        // Act
        await api.DeactivateAsync(world.Member, world.Owner);
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/WEB/members/{world.Viewer.Id}", _ct)).EnsureSuccessStatusCode();
        var ticket = await world.OwnerClient.GetTicketAsync("WEB-1");

        // Assert
        Assert.Empty(ticket.Mentions);
        Assert.Empty(Assert.Single(ticket.Comments!).Mentions);
    }

    [Fact]
    public async Task Renamed_users_show_their_current_name_while_the_stored_text_keeps_the_old_one()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Rename", extra: new { description = world.Member.Mention() });

        // Act
        await api.WithDbAsync(async db =>
        {
            var member = await db.Users.FindAsync(world.Member.Id);
            member!.ChangeDisplayName("Mia Renamed");
            return await db.SaveChangesAsync();
        });
        var ticket = await world.OwnerClient.GetTicketAsync("WEB-1");

        // Assert
        Assert.Equal("Mia Renamed", Assert.Single(ticket.Mentions).DisplayName);
        Assert.Equal(world.Member.Mention(), ticket.Description);
    }

    [Fact]
    public async Task Mentions_inside_code_are_not_listed()
    {
        // Arrange
        var world = await api.SeedWorldAsync();

        // Act
        await world.OwnerClient.CreateTicketAsync("WEB", "Code", extra: new { description = $"```\n{world.Member.Mention()}\n```" });
        var ticket = await world.OwnerClient.GetTicketAsync("WEB-1");

        // Assert
        Assert.Empty(ticket.Mentions);
    }
}
