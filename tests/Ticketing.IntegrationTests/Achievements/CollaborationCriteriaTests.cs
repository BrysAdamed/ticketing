using System.Net;
using System.Net.Http.Json;
using ModelContextProtocol.Client;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Attachments;
using Ticketing.IntegrationTests.Docs;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary>The collaboration criteria of spec 15.4: conversationalist, show-me and machine-whisperer.</summary>
[Collection(nameof(AchievementsCollection))]
public sealed class CollaborationCriteriaTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Conversationalist_counts_comments_on_tickets_and_docs_that_are_still_there()
    {
        // Arrange
        var world = await WorldAsync();
        var ticket = await world.Owner.CreateTicketAsync("WEB", "Discussed");
        var doomed = await world.Owner.CreateTicketAsync("WEB", "Deleted later");
        var page = await world.Owner.CreatePageAsync("WEB", "Notes");
        var deletedPage = await world.Owner.CreatePageAsync("WEB", "Deleted page");
        await CommentAsync(world.User, ticket.Key);
        var start = DateTimeOffset.UtcNow;
        await CommentAsync(world.User, ticket.Key);
        await CommentAsync(world.User, ticket.Key);
        await world.Mcp.CallOkAsync("add_comment", new() { ["key"] = ticket.Key, ["body"] = "Over MCP" });
        await world.User.AddDocCommentAsync(page.Key, "On a doc");
        await world.Mcp.CallOkAsync("add_doc_comment", new() { ["docKey"] = page.Key, ["body"] = "On a doc over MCP" });
        var deletedComment = await CommentAsync(world.User, ticket.Key);
        (await world.User.DeleteAsync($"/api/v1/comments/{deletedComment}", _ct)).EnsureSuccessStatusCode();
        var deletedDocComment = await world.User.AddDocCommentAsync(page.Key, "Withdrawn");
        (await world.User.DeleteAsync($"/api/v1/docs/comments/{deletedDocComment.Id}", _ct)).EnsureSuccessStatusCode();
        await CommentAsync(world.User, doomed.Key);
        await (await world.Owner.DeleteTicketAsync(doomed.Key)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await world.User.AddDocCommentAsync(deletedPage.Key, "On a page that goes away");
        (await world.Owner.DeleteAsync($"/api/v1/docs/{deletedPage.Key}", _ct)).EnsureSuccessStatusCode();
        await CommentAsync(world.Other, ticket.Key);

        // Act
        var progress = await api.EvaluateAsync(
            [new(world.UserAccount.Id, start), new(world.OtherAccount.Id, start)], [AchievementCatalog.Conversationalist]);

        // Assert
        Assert.Equal((5, 1), progress.Where(p => p.UserId == world.UserAccount.Id).Select(p => (p.Count, p.Tier)).Single());
        Assert.Equal(1, progress.Single(p => p.UserId == world.OtherAccount.Id).Count);
    }

    [Fact]
    public async Task Show_me_counts_attachments_on_tickets_and_docs_that_still_exist()
    {
        // Arrange
        var world = await WorldAsync();
        var ticket = await world.Owner.CreateTicketAsync("WEB", "Screenshots");
        var doomed = await world.Owner.CreateTicketAsync("WEB", "Deleted later");
        var page = await world.Owner.CreatePageAsync("WEB", "Notes");
        await (await AttachmentTests.UploadAsync(world.User, ticket.Key, "before.png", "image/png", AttachmentTests.Png)).IdAsync();
        var start = DateTimeOffset.UtcNow;
        await (await AttachmentTests.UploadAsync(world.User, ticket.Key, "one.png", "image/png", AttachmentTests.Png)).IdAsync();
        await (await AttachmentTests.UploadAsync(world.User, ticket.Key, "two.png", "image/png", AttachmentTests.Png)).IdAsync();
        await (await world.User.UploadDocAttachmentAsync(page.Key, "doc.png", "image/png", AttachmentTests.Png)).IdAsync();
        var removed = await (await AttachmentTests.UploadAsync(world.User, ticket.Key, "removed.png", "image/png", AttachmentTests.Png)).IdAsync();
        (await world.User.DeleteAsync($"/api/v1/attachments/{removed}", _ct)).EnsureSuccessStatusCode();
        await (await AttachmentTests.UploadAsync(world.User, doomed.Key, "gone.png", "image/png", AttachmentTests.Png)).IdAsync();
        await (await world.Owner.DeleteTicketAsync(doomed.Key)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await (await AttachmentTests.UploadAsync(world.Other, ticket.Key, "other.png", "image/png", AttachmentTests.Png)).IdAsync();

        // Act
        var progress = await api.EvaluateAsync(
            [new(world.UserAccount.Id, start), new(world.OtherAccount.Id, start)], [AchievementCatalog.ShowMe]);

        // Assert
        Assert.Equal((3, 1), progress.Where(p => p.UserId == world.UserAccount.Id).Select(p => (p.Count, p.Tier)).Single());
        Assert.Equal(1, progress.Single(p => p.UserId == world.OtherAccount.Id).Count);
    }

    [Fact]
    public async Task Machine_whisperer_needs_a_write_over_mcp_after_the_start_and_not_a_pat_or_a_read()
    {
        // Arrange
        var world = await WorldAsync();
        var ticket = await world.Owner.CreateTicketAsync("WEB", "Watched");
        await world.Mcp.CallOkAsync("add_comment", new() { ["key"] = ticket.Key, ["body"] = "Before the start" });
        var start = DateTimeOffset.UtcNow;
        var pat = await api.CreatePatClientAsync(world.UserAccount);
        await pat.CreateTicketAsync("WEB", "Over a PAT");
        await world.Mcp.CallOkAsync("get_ticket", new() { ["key"] = ticket.Key });
        await world.Mcp.CallOkAsync("watch_ticket", new() { ["key"] = ticket.Key });
        var before = await api.CountAsync(world.UserAccount, start, AchievementCatalog.MachineWhisperer);

        // Act
        await world.Mcp.CallOkAsync("add_comment", new() { ["key"] = ticket.Key, ["body"] = "First" });
        await world.Mcp.CallOkAsync("add_comment", new() { ["key"] = ticket.Key, ["body"] = "Second" });

        // Assert
        Assert.Equal(0, before);
        var progress = await api.EvaluateAsync(
            [new(world.UserAccount.Id, start), new(world.OtherAccount.Id, start)], [AchievementCatalog.MachineWhisperer]);
        Assert.Equal((1, 1), progress.Where(p => p.UserId == world.UserAccount.Id).Select(p => (p.Count, p.Tier)).Single());
        Assert.Equal(0, progress.Single(p => p.UserId == world.OtherAccount.Id).Count);
    }

    private async Task<Guid> CommentAsync(HttpClient client, string ticketKey) =>
        await (await client.PostAsJsonAsync($"/api/v1/tickets/{ticketKey}/comments", new { body = "A comment" }, HttpAssertions.Json, _ct)).IdAsync();

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
        return new World(userAccount, otherAccount, owner, await api.LoginAsync(userAccount), await api.LoginAsync(otherAccount), mcp);
    }

    private sealed record World(TestUser UserAccount, TestUser OtherAccount, HttpClient Owner, HttpClient User, HttpClient Other, McpClient Mcp);
}
