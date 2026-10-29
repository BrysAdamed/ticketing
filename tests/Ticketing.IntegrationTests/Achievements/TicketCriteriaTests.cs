using System.Net;
using System.Net.Http.Json;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Agents;
using Ticketing.IntegrationTests.Boards;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary>The ticket criteria of spec 15.4: reporter, bug-hunter, closer, exterminator, ready-for-review, triage, connector, delegator.</summary>
[Collection(nameof(AchievementsCollection))]
public sealed class TicketCriteriaTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Reporter_counts_alive_tickets_created_after_the_start_on_every_channel_and_nobody_elses()
    {
        // Arrange
        var world = await WorldAsync();
        await world.User.CreateTicketAsync("WEB", "Before the start");
        var start = DateTimeOffset.UtcNow;
        await world.User.CreateTicketAsync("WEB", "Over REST");
        await world.Mcp.CallOkAsync("create_ticket", new() { ["projectKey"] = "WEB", ["title"] = "Over MCP", ["type"] = "Technical" });
        await (await world.User.PostAsJsonAsync("/api/v1/projects/WEB/tickets/batch",
            new { tickets = new[] { new { title = "Batch one", type = "Technical" }, new { title = "Batch two", type = "Technical" } } }, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);
        var deleted = await world.User.CreateTicketAsync("WEB", "Deleted later");
        await (await world.Owner.DeleteTicketAsync(deleted.Key)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await world.Other.CreateTicketAsync("WEB", "Someone else's");

        // Act
        var count = await api.CountAsync(world.UserAccount, start, AchievementCatalog.Reporter);

        // Assert
        Assert.Equal(4, count);
    }

    [Fact]
    public async Task Tickets_in_a_deleted_project_no_longer_count()
    {
        // Arrange
        var world = await WorldAsync();
        var start = DateTimeOffset.UtcNow;
        await world.User.CreateTicketAsync("WEB", "Gone with the project", "Bug");
        await api.DeleteProjectAsync("WEB");

        // Act
        var progress = await api.EvaluateAsync([new(world.UserAccount.Id, start)], [AchievementCatalog.Reporter, AchievementCatalog.BugHunter]);

        // Assert
        Assert.All(progress, p => Assert.Equal((0, 0), (p.Count, p.Tier)));
    }

    [Fact]
    public async Task Bug_hunter_counts_only_tickets_that_are_bugs_at_evaluation()
    {
        // Arrange
        var world = await WorldAsync();
        var start = DateTimeOffset.UtcNow;
        await world.User.CreateTicketAsync("WEB", "A bug", "Bug");
        await world.Mcp.CallOkAsync("create_ticket", new() { ["projectKey"] = "WEB", ["title"] = "Another bug", ["type"] = "Bug" });
        await world.User.CreateTicketAsync("WEB", "A story");
        var retyped = await world.User.CreateTicketAsync("WEB", "Was a bug", "Bug");
        await world.User.PatchTicketAsync(retyped.Key, new { type = "Technical" });
        await world.Other.CreateTicketAsync("WEB", "Someone else's bug", "Bug");

        // Act
        var count = await api.CountAsync(world.UserAccount, start, AchievementCatalog.BugHunter);

        // Assert
        Assert.Equal(2, count);
    }

    [Fact]
    public async Task Closer_counts_each_ticket_once_per_user_however_often_it_is_toggled_in_and_out_of_done()
    {
        // Arrange
        var world = await WorldAsync();
        var before = await world.Owner.CreateTicketAsync("WEB", "Closed before the start");
        await world.User.PatchTicketAsync(before.Key, new { status = "Done" });
        var start = DateTimeOffset.UtcNow;
        var toggled = await world.Owner.CreateTicketAsync("WEB", "Toggled");
        await world.User.PatchTicketAsync(toggled.Key, new { status = "Done" });
        await world.User.PatchTicketAsync(toggled.Key, new { status = "InProgress" });
        await world.Mcp.CallOkAsync("update_ticket", new() { ["key"] = toggled.Key, ["status"] = "Done" });
        var byMcp = await world.Owner.CreateTicketAsync("WEB", "Closed over MCP");
        await world.Mcp.CallOkAsync("update_ticket", new() { ["key"] = byMcp.Key, ["status"] = "Done" });
        var reopened = await world.Owner.CreateTicketAsync("WEB", "Closed by someone else first");
        await world.Other.PatchTicketAsync(reopened.Key, new { status = "Done" });
        await world.Other.PatchTicketAsync(reopened.Key, new { status = "ToDo" });
        await world.User.PatchTicketAsync(reopened.Key, new { status = "Done" });
        await world.User.CreateTicketAsync("WEB", "Created in Done", extra: new { status = "Done" });
        var deleted = await world.Owner.CreateTicketAsync("WEB", "Closed then deleted");
        await world.User.PatchTicketAsync(deleted.Key, new { status = "Done" });
        await (await world.Owner.DeleteTicketAsync(deleted.Key)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await world.Other.PatchTicketAsync((await world.Owner.CreateTicketAsync("WEB", "Only someone else")).Key, new { status = "Done" });

        // Act
        var progress = await api.EvaluateAsync(
            [new(world.UserAccount.Id, start), new(world.OtherAccount.Id, start)], [AchievementCatalog.Closer]);

        // Assert
        Assert.Equal(3, progress.Single(p => p.UserId == world.UserAccount.Id).Count);
        Assert.Equal(2, progress.Single(p => p.UserId == world.OtherAccount.Id).Count);
    }

    [Fact]
    public async Task Board_moves_to_done_count_for_closer_and_exterminator_counts_only_bugs()
    {
        // Arrange
        var world = await WorldAsync();
        var board = await world.Owner.CreateBoardAsync("Sprint", "WEB");
        var bug = await world.Owner.CreateTicketAsync("WEB", "A bug", "Bug");
        var story = await world.Owner.CreateTicketAsync("WEB", "A story");
        var start = DateTimeOffset.UtcNow;

        // Act
        await world.User.MoveOkAsync(board.Id.ToString(), [bug.Key, story.Key], status: "Done");

        // Assert
        var progress = await api.EvaluateAsync([new(world.UserAccount.Id, start)], [AchievementCatalog.Closer, AchievementCatalog.Exterminator]);
        Assert.Equal(2, progress.Single(p => p.AchievementId == AchievementCatalog.Closer).Count);
        Assert.Equal(1, progress.Single(p => p.AchievementId == AchievementCatalog.Exterminator).Count);
    }

    [Fact]
    public async Task Ready_for_review_counts_distinct_tickets_moved_to_review_after_the_start()
    {
        // Arrange
        var world = await WorldAsync();
        var first = await world.Owner.CreateTicketAsync("WEB", "First");
        await world.User.PatchTicketAsync(first.Key, new { status = "Review" });
        var start = DateTimeOffset.UtcNow;
        await world.User.PatchTicketAsync(first.Key, new { status = "InProgress" });
        await world.User.PatchTicketAsync(first.Key, new { status = "Review" });
        await world.User.PatchTicketAsync(first.Key, new { status = "InProgress" });
        await world.Mcp.CallOkAsync("update_ticket", new() { ["key"] = first.Key, ["status"] = "Review" });
        var second = await world.Owner.CreateTicketAsync("WEB", "Second");
        await world.User.PatchTicketAsync(second.Key, new { status = "Done" });
        await world.Other.PatchTicketAsync((await world.Owner.CreateTicketAsync("WEB", "Third")).Key, new { status = "Review" });

        // Act
        var count = await api.CountAsync(world.UserAccount, start, AchievementCatalog.ReadyForReview);

        // Assert
        Assert.Equal(1, count);
    }

    [Fact]
    public async Task Triage_counts_tickets_assigned_to_someone_else_at_creation_or_later_but_not_to_yourself()
    {
        // Arrange
        var world = await WorldAsync();
        var start = DateTimeOffset.UtcNow;
        await world.User.CreateTicketAsync("WEB", "Assigned at creation", extra: new { assignee = world.OtherAccount.Email });
        await world.Mcp.CallOkAsync("create_ticket", new()
        {
            ["projectKey"] = "WEB", ["title"] = "Assigned at creation over MCP", ["type"] = "Technical", ["assignee"] = world.OtherAccount.Email,
        });
        await (await world.User.PostAsJsonAsync("/api/v1/projects/WEB/tickets/batch",
            new { tickets = new[] { new { title = "Batch", type = "Technical", assignee = world.OtherAccount.Email } } }, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);
        var later = await world.Owner.CreateTicketAsync("WEB", "Assigned later");
        await world.User.PatchTicketAsync(later.Key, new { assignee = world.OtherAccount.Email });
        await world.User.PatchTicketAsync(later.Key, new { assignee = (string?)null });
        await world.Mcp.CallOkAsync("update_ticket", new() { ["key"] = later.Key, ["assignee"] = world.OwnerAccount.Email });
        await world.User.CreateTicketAsync("WEB", "To myself", extra: new { assignee = "me" });
        await world.User.PatchTicketAsync((await world.Owner.CreateTicketAsync("WEB", "Myself later")).Key, new { assignee = "me" });
        await world.User.CreateTicketAsync("WEB", "Unassigned");
        var deleted = await world.User.CreateTicketAsync("WEB", "Assigned then deleted", extra: new { assignee = world.OtherAccount.Email });
        await (await world.Owner.DeleteTicketAsync(deleted.Key)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await world.Other.CreateTicketAsync("WEB", "Someone else triages", extra: new { assignee = world.UserAccount.Email });

        // Act
        var progress = await api.EvaluateAsync(
            [new(world.UserAccount.Id, start), new(world.OtherAccount.Id, start)], [AchievementCatalog.Triage]);

        // Assert
        Assert.Equal((4, 0), progress.Where(p => p.UserId == world.UserAccount.Id).Select(p => (p.Count, p.Tier)).Single());
        Assert.Equal(1, progress.Single(p => p.UserId == world.OtherAccount.Id).Count);
    }

    [Fact]
    public async Task Connector_counts_links_the_user_added_after_the_start_that_still_exist()
    {
        // Arrange
        var world = await WorldAsync();
        var a = await world.Owner.CreateTicketAsync("WEB", "A");
        var b = await world.Owner.CreateTicketAsync("WEB", "B");
        var c = await world.Owner.CreateTicketAsync("WEB", "C");
        var d = await world.Owner.CreateTicketAsync("WEB", "D");
        await (await world.User.LinkAsync(a.Key, d.Key)).ShouldHaveStatusAsync(HttpStatusCode.Created);
        var start = DateTimeOffset.UtcNow;
        await (await world.User.LinkAsync(a.Key, b.Key, "Blocks")).ShouldHaveStatusAsync(HttpStatusCode.Created);
        await (await world.User.LinkAsync(c.Key, a.Key)).ShouldHaveStatusAsync(HttpStatusCode.Created);
        await world.Mcp.CallOkAsync("link_tickets", new() { ["sourceKey"] = b.Key, ["targetKey"] = c.Key, ["type"] = "Duplicates" });
        var removed = await (await world.User.LinkAsync(b.Key, d.Key)).IdAsync();
        await (await world.User.DeleteAsync($"/api/v1/tickets/{b.Key}/links/{removed}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await (await world.Other.LinkAsync(b.Key, d.Key)).ShouldHaveStatusAsync(HttpStatusCode.Created);
        await (await world.User.LinkAsync(c.Key, d.Key, "Blocks")).ShouldHaveStatusAsync(HttpStatusCode.Created);
        await (await world.Owner.DeleteTicketAsync(d.Key)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

        // Act
        var progress = await api.EvaluateAsync(
            [new(world.UserAccount.Id, start), new(world.OtherAccount.Id, start)], [AchievementCatalog.Connector]);

        // Assert
        Assert.Equal(3, progress.Single(p => p.UserId == world.UserAccount.Id).Count);
        Assert.Equal(0, progress.Single(p => p.UserId == world.OtherAccount.Id).Count);
    }

    [Fact]
    public async Task Delegator_counts_distinct_alive_tickets_delegated_after_the_start()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var projectId = await api.ProjectAsync(owner, "AGT", members: (member, ProjectRole.Member));
        var before = await api.TicketAsync(projectId, owner);
        var twice = await api.TicketAsync(projectId, owner);
        var deleted = await api.TicketAsync(projectId, owner);
        await api.EnableAgentFlagAsync(owner, member);
        var client = await api.LoginAsync(member);
        await DelegateAsync(client, before);
        var start = DateTimeOffset.UtcNow;
        await DelegateAsync(client, twice);
        await DelegateAsync(client, twice);
        await DelegateAsync(client, deleted);
        await (await (await api.LoginAsync(owner)).DeleteTicketAsync(deleted)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await DelegateAsync(await api.LoginAsync(owner), before);

        // Act
        var progress = await api.EvaluateAsync([new(member.Id, start), new(owner.Id, start)], [AchievementCatalog.Delegator]);

        // Assert
        Assert.Equal((1, 1), progress.Where(p => p.UserId == member.Id).Select(p => (p.Count, p.Tier)).Single());
        Assert.Equal(1, progress.Single(p => p.UserId == owner.Id).Count);
    }

    private async Task DelegateAsync(HttpClient client, string ticketKey) =>
        await (await client.PostAsJsonAsync($"/api/v1/tickets/{ticketKey}/agent-delegations", new { app = "ClaudeCode" }, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.OK);

    private async Task<World> WorldAsync()
    {
        var ownerAccount = await api.CreateUserAsync();
        var userAccount = await api.CreateUserAsync();
        var otherAccount = await api.CreateUserAsync();
        var owner = await api.LoginAsync(ownerAccount);
        var project = await owner.CreateProjectAsync("WEB");
        await api.AddMemberAsync(project.Id, userAccount, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, otherAccount, ProjectRole.Member);
        var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(userAccount));
        return new World(ownerAccount, userAccount, otherAccount, owner, await api.LoginAsync(userAccount), await api.LoginAsync(otherAccount), mcp);
    }

    private sealed record World(
        TestUser OwnerAccount, TestUser UserAccount, TestUser OtherAccount, HttpClient Owner, HttpClient User, HttpClient Other,
        ModelContextProtocol.Client.McpClient Mcp);
}
