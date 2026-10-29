using System.Net;
using ModelContextProtocol.Client;
using Ticketing.Application.Achievements;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Mentions;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary>The criteria of spec 15.4 that read ticket state when evaluated: epic-finisher and shout-out (TKT-95).</summary>
[Collection(nameof(AchievementsCollection))]
public sealed class TicketStateCriteriaTests(TicketingApiFactory api)
{
    [Fact]
    public async Task Epic_finisher_counts_an_epic_moved_to_done_whose_direct_children_are_all_done_over_rest_and_mcp()
    {
        // Arrange
        var world = await WorldAsync();
        var overRest = await world.MemberAsync();
        var overMcp = await world.MemberAsync();
        var childDoneLater = await world.MemberAsync();
        var start = DateTimeOffset.UtcNow;
        var first = await EpicAsync(world, childStatuses: ["Done", "Done"]);
        await overRest.Client.PatchTicketAsync(first, new { status = "Done" });
        var second = await EpicAsync(world, childStatuses: ["Done"]);
        var deletedChild = await world.Owner.CreateTicketAsync("WEB", "Open but deleted", extra: new { parentKey = second });
        await (await world.Owner.DeleteTicketAsync(deletedChild.Key)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await overMcp.Mcp.CallOkAsync("update_ticket", new() { ["key"] = second, ["status"] = "Done" });
        var third = await world.Owner.CreateTicketAsync("WEB", "Closed before its child", "Epic");
        var lateChild = await world.Owner.CreateTicketAsync("WEB", "Done later", extra: new { parentKey = third.Key });
        await childDoneLater.Client.PatchTicketAsync(third.Key, new { status = "Done" });
        var whileOpen = await api.CountAsync(childDoneLater.Account, start, AchievementCatalog.EpicFinisher);
        await world.Owner.PatchTicketAsync(lateChild.Key, new { status = "Done" });

        // Act
        var progress = await api.EvaluateAsync(
            [new(overRest.Account.Id, start), new(overMcp.Account.Id, start), new(childDoneLater.Account.Id, start), new(world.OwnerAccount.Id, start)],
            [AchievementCatalog.EpicFinisher]);

        // Assert
        Assert.Equal((1, 1), Of(progress, overRest.Account));
        Assert.Equal((1, 1), Of(progress, overMcp.Account));
        Assert.Equal(0, whileOpen);
        Assert.Equal((1, 1), Of(progress, childDoneLater.Account));
        Assert.Equal((0, 0), Of(progress, world.OwnerAccount));
    }

    [Fact]
    public async Task Epic_finisher_ignores_childless_unfinished_reopened_and_non_epic_tickets_and_closes_before_the_start()
    {
        // Arrange
        var world = await WorldAsync();
        var childless = await world.MemberAsync();
        var unfinished = await world.MemberAsync();
        var reopened = await world.MemberAsync();
        var notAnEpic = await world.MemberAsync();
        var early = await world.MemberAsync();
        var closedEarly = await EpicAsync(world, childStatuses: ["Done"]);
        await early.Client.PatchTicketAsync(closedEarly, new { status = "Done" });
        var start = DateTimeOffset.UtcNow;
        await childless.Client.PatchTicketAsync((await world.Owner.CreateTicketAsync("WEB", "No children", "Epic")).Key, new { status = "Done" });
        await unfinished.Client.PatchTicketAsync(await EpicAsync(world, childStatuses: ["Done", "Review"]), new { status = "Done" });
        var reopenedEpic = await EpicAsync(world, childStatuses: ["Done"]);
        await reopened.Client.PatchTicketAsync(reopenedEpic, new { status = "Done" });
        await world.Owner.PatchTicketAsync(reopenedEpic, new { status = "InProgress" });
        var story = await world.Owner.CreateTicketAsync("WEB", "A story");
        await world.Owner.CreateTicketAsync("WEB", "A done task", "Technical", extra: new { parentKey = story.Key, status = "Done" });
        await notAnEpic.Client.PatchTicketAsync(story.Key, new { status = "Done" });

        // Act
        var progress = await api.EvaluateAsync(
            [.. new[] { childless, unfinished, reopened, notAnEpic, early }.Select(m => new AchievementSubject(m.Account.Id, start))],
            [AchievementCatalog.EpicFinisher]);

        // Assert
        Assert.All(progress, p => Assert.Equal((0, 0), (p.Count, p.Tier)));
    }

    [Fact]
    public async Task Epic_finisher_no_longer_counts_once_the_project_is_deleted()
    {
        // Arrange
        var world = await WorldAsync();
        var closer = await world.MemberAsync();
        var start = DateTimeOffset.UtcNow;
        await closer.Client.PatchTicketAsync(await EpicAsync(world, childStatuses: ["Done"]), new { status = "Done" });
        var before = await api.CountAsync(closer.Account, start, AchievementCatalog.EpicFinisher);

        // Act
        await api.DeleteProjectAsync("WEB");

        // Assert
        Assert.Equal(1, before);
        Assert.Equal(0, await api.CountAsync(closer.Account, start, AchievementCatalog.EpicFinisher));
    }

    [Fact]
    public async Task Shout_out_counts_a_new_mention_of_a_teammate_in_a_comment_a_description_or_a_new_ticket_on_every_channel()
    {
        // Arrange
        var world = await WorldAsync();
        var restComment = await world.MemberAsync();
        var mcpComment = await world.MemberAsync();
        var restEdit = await world.MemberAsync();
        var mcpEdit = await world.MemberAsync();
        var restDescription = await world.MemberAsync();
        var mcpDescription = await world.MemberAsync();
        var mcpCreate = await world.MemberAsync();
        var quiet = await world.MemberAsync();
        var ticket = await world.Owner.CreateTicketAsync("WEB", "Discussed", extra: new { description = "Some text." });
        var mention = world.OwnerAccount.Mention();
        var start = DateTimeOffset.UtcNow;
        await restComment.Client.AddCommentAsync(ticket.Key, $"Have a look {mention}");
        await mcpComment.Mcp.CallOkAsync("add_comment", new() { ["key"] = ticket.Key, ["body"] = $"Over MCP {mention}" });
        var edited = await restEdit.Client.AddCommentAsync(ticket.Key, "No mention yet");
        await restEdit.Client.EditCommentAsync(edited.Id, $"Now {mention}");
        var editedOverMcp = await mcpEdit.Client.AddCommentAsync(ticket.Key, "No mention yet");
        await mcpEdit.Mcp.CallOkAsync("update_comment", new() { ["commentId"] = editedOverMcp.Id, ["body"] = $"Now {mention}" });
        await restDescription.Client.PatchTicketAsync(ticket.Key, new { description = $"Some text. {mention}" });
        await mcpDescription.Mcp.CallOkAsync("update_ticket", new() { ["key"] = ticket.Key, ["description"] = $"Rewritten. {restComment.Account.Mention()}" });
        await mcpCreate.Mcp.CallOkAsync("create_ticket", new()
        {
            ["projectKey"] = "WEB", ["title"] = "Mentioning", ["type"] = "Technical", ["description"] = $"For {mention}",
        });
        await quiet.Client.AddCommentAsync(ticket.Key, "No one in particular");

        // Act
        var progress = await api.EvaluateAsync(
            [.. new[] { restComment, mcpComment, restEdit, mcpEdit, restDescription, mcpDescription, mcpCreate, quiet }
                .Select(m => new AchievementSubject(m.Account.Id, start))],
            [AchievementCatalog.ShoutOut]);

        // Assert
        Assert.Equal(
            [(1, 1), (1, 1), (1, 1), (1, 1), (1, 1), (1, 1), (1, 1), (0, 0)],
            new[] { restComment, mcpComment, restEdit, mcpEdit, restDescription, mcpDescription, mcpCreate, quiet }.Select(m => Of(progress, m.Account)));
    }

    [Fact]
    public async Task Shout_out_ignores_self_mentions_mentions_already_there_mentions_in_code_and_mentions_before_the_start()
    {
        // Arrange
        var world = await WorldAsync();
        var self = await world.MemberAsync();
        var keptInComment = await world.MemberAsync();
        var keptInDescription = await world.MemberAsync();
        var inCode = await world.MemberAsync();
        var early = await world.MemberAsync();
        var mention = world.OwnerAccount.Mention();
        var ticket = await world.Owner.CreateTicketAsync("WEB", "Discussed");
        var kept = await keptInComment.Client.AddCommentAsync(ticket.Key, $"Hello {mention}");
        var described = await keptInDescription.Client.CreateTicketAsync("WEB", "Described", extra: new { description = $"For {mention}" });
        await early.Client.AddCommentAsync(ticket.Key, $"Early {mention}");
        var start = DateTimeOffset.UtcNow;
        await self.Client.AddCommentAsync(ticket.Key, $"Note to {self.Account.Mention()}");
        await keptInComment.Client.EditCommentAsync(kept.Id, $"Hello again {mention}");
        await keptInDescription.Client.PatchTicketAsync(described.Key, new { description = $"For {mention}, with more detail" });
        await inCode.Client.AddCommentAsync(ticket.Key, $"Syntax: `{mention}`");

        // Act
        var progress = await api.EvaluateAsync(
            [.. new[] { self, keptInComment, keptInDescription, inCode, early }.Select(m => new AchievementSubject(m.Account.Id, start))],
            [AchievementCatalog.ShoutOut]);

        // Assert
        Assert.All(progress, p => Assert.Equal((0, 0), (p.Count, p.Tier)));
    }

    [Fact]
    public async Task Shout_out_ignores_deleted_comments_and_deleted_tickets_and_skips_users_who_already_hold_it()
    {
        // Arrange
        var world = await WorldAsync();
        var deletedComment = await world.MemberAsync();
        var deletedTicket = await world.MemberAsync();
        var holder = await world.MemberAsync();
        var mention = world.OwnerAccount.Mention();
        var ticket = await world.Owner.CreateTicketAsync("WEB", "Discussed");
        var doomed = await world.Owner.CreateTicketAsync("WEB", "Deleted later");
        await api.WithDbAsync(async db =>
        {
            db.UserAchievements.Add(UserAchievement.Create(holder.Account.Id, AchievementCatalog.ShoutOut, 1, DateTimeOffset.UtcNow));
            return await db.SaveChangesAsync();
        });
        var start = DateTimeOffset.UtcNow;
        var withdrawn = await deletedComment.Client.AddCommentAsync(ticket.Key, $"Withdrawn {mention}");
        (await deletedComment.Client.DeleteAsync($"/api/v1/comments/{withdrawn.Id}", TestContext.Current.CancellationToken)).EnsureSuccessStatusCode();
        await deletedTicket.Client.AddCommentAsync(doomed.Key, $"Gone {mention}");
        await (await world.Owner.DeleteTicketAsync(doomed.Key)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await holder.Client.AddCommentAsync(ticket.Key, $"Again {mention}");

        // Act
        var progress = await api.EvaluateAsync(
            [.. new[] { deletedComment, deletedTicket, holder }.Select(m => new AchievementSubject(m.Account.Id, start))],
            [AchievementCatalog.ShoutOut]);

        // Assert
        Assert.All(progress, p => Assert.Equal((0, 0), (p.Count, p.Tier)));
    }

    private static (int Count, int Tier) Of(IReadOnlyList<AchievementProgress> progress, TestUser user) =>
        progress.Where(p => p.UserId == user.Id).Select(p => (p.Count, p.Tier)).Single();

    private static async Task<string> EpicAsync(World world, string[] childStatuses)
    {
        var epic = await world.Owner.CreateTicketAsync("WEB", "An epic", "Epic");
        foreach (var status in childStatuses)
            await world.Owner.CreateTicketAsync("WEB", $"A {status} child", extra: new { parentKey = epic.Key, status });
        return epic.Key;
    }

    private async Task<World> WorldAsync()
    {
        var ownerAccount = await api.CreateUserAsync();
        var owner = await api.LoginAsync(ownerAccount);
        var project = await owner.CreateProjectAsync("WEB");
        return new World(api, project.Id, ownerAccount, owner);
    }

    private sealed record World(TicketingApiFactory Api, Guid ProjectId, TestUser OwnerAccount, HttpClient Owner)
    {
        public async Task<Member> MemberAsync()
        {
            var account = await Api.CreateUserAsync();
            await Api.AddMemberAsync(ProjectId, account, ProjectRole.Member);
            return new Member(account, await Api.LoginAsync(account), await Api.CreateMcpClientAsync(await Api.CreatePatAsync(account)));
        }
    }

    private sealed record Member(TestUser Account, HttpClient Client, McpClient Mcp);
}
