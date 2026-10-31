using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Comments;
using Ticketing.Domain.Collaboration;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Mentions;
using Ticketing.IntegrationTests.Notifications;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>@mentions in doc comments (I-86, D-96, D-162): normalized and validated like ticket comments, notify and make watchers.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocCommentMentionTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_mentioned_user_is_notified_with_mentioned_instead_of_commented_and_starts_watching()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DMA");
        var page = await world.OwnerClient.CreatePageAsync("DMA", "Rollout");
        await world.MemberClient.WatchDocAsync(page.Key);

        // Act
        var comment = await world.OwnerClient.AddDocCommentAsync(page.Key, $"{world.Member.Mention()} and @{world.Viewer.Email}, please check");

        // Assert
        Assert.Equal($"{world.Member.Mention()} and {world.Viewer.Mention()}, please check", comment.Body);
        Assert.Equal([world.Member.Id, world.Viewer.Id], comment.Mentions.Ids());
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you in a comment", 1)], (await api.StoredNotificationsAsync(world.Member)).Rows());
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you in a comment", 1)], (await api.StoredNotificationsAsync(world.Viewer)).Rows());
        Assert.True((await world.ViewerClient.DocWatchersAsync(page.Key)).Watching);
        var listed = Assert.Single((await world.ViewerClient.DocCommentsAsync(page.Key)).Items);
        Assert.Equal([world.Member.Id, world.Viewer.Id], listed.Mentions.Ids());
    }

    [Fact]
    public async Task An_edit_notifies_only_newly_added_mentions_and_never_the_author()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DMB");
        var page = await world.OwnerClient.CreatePageAsync("DMB", "Plan");
        var comment = await world.OwnerClient.AddDocCommentAsync(page.Key, $"Ping {world.Member.Mention()}");
        await api.ClearNotificationsAsync();

        // Act
        var same = await world.OwnerClient.PatchDocCommentAsync(comment.Id, $"Ping {world.Member.Mention()} again {world.Owner.Mention()}");
        var added = await world.OwnerClient.PatchDocCommentAsync(comment.Id, $"Ping {world.Member.Mention()} and {world.Viewer.Mention()}");

        // Assert
        await same.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await added.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
        Assert.Empty(await api.StoredNotificationsAsync(world.Owner));
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you in a comment", 1)], (await api.StoredNotificationsAsync(world.Viewer)).Rows());
        Assert.True((await world.ViewerClient.DocWatchersAsync(page.Key)).Watching);
    }

    [Fact]
    public async Task Mentioning_someone_who_cannot_read_the_project_is_rejected_and_mentions_survive_a_project_mute()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DMC");
        var outsider = await api.CreateUserAsync(displayName: "Outsider Olga");
        var page = await world.OwnerClient.CreatePageAsync("DMC", "Secret");
        var comment = await world.OwnerClient.AddDocCommentAsync(page.Key, "Draft");
        (await world.MemberClient.UpdatePreferencesAsync(new { muteProjects = new[] { "DMC" } })).EnsureSuccessStatusCode();

        // Act
        var rejected = await world.OwnerClient.PostDocCommentAsync(page.Key, $"Hey {outsider.Mention()}");
        var editRejected = await world.OwnerClient.PatchDocCommentAsync(comment.Id, $"Hey @{outsider.Email}");
        await world.OwnerClient.AddDocCommentAsync(page.Key, $"Hey {world.Member.Mention()}");

        // Assert
        var problem = await rejected.ShouldBeProblemAsync(HttpStatusCode.BadRequest, CollaborationErrors.MentionInvalid);
        Assert.Contains("Outsider Olga", problem.GetProperty("errors").GetProperty("body")[0].GetString(), StringComparison.Ordinal);
        await editRejected.ShouldBeProblemAsync(HttpStatusCode.BadRequest, CollaborationErrors.MentionInvalid);
        Assert.Equal(2, (await world.OwnerClient.DocCommentsAsync(page.Key)).Items.Count);
        Assert.Empty(await api.StoredNotificationsAsync(outsider));
        Assert.Equal([NotificationKind.Mentioned], (await api.StoredNotificationsAsync(world.Member)).Select(n => n.Kind));
    }

    [Fact]
    public async Task Mentions_of_users_who_lost_access_render_as_plain_text_and_do_not_block_edits()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DMD");
        var page = await world.OwnerClient.CreatePageAsync("DMD", "Handover");
        var comment = await world.OwnerClient.AddDocCommentAsync(page.Key, $"Thanks {world.Member.Mention()}");
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/DMD/members/{world.Member.Id}", _ct)).EnsureSuccessStatusCode();

        // Act
        var listed = await world.OwnerClient.DocCommentsAsync(page.Key);
        var edited = await world.OwnerClient.PatchDocCommentAsync(comment.Id, $"Thanks {world.Member.Mention()}!");

        // Assert
        Assert.Empty(Assert.Single(listed.Items).Mentions);
        await edited.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Mentions_in_doc_comments_work_over_mcp()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DME");
        var page = await world.OwnerClient.CreatePageAsync("DME", "Via MCP");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Owner));

        // Act
        var result = await mcp.CallToolAsync(
            "add_doc_comment", new Dictionary<string, object?> { ["docKey"] = page.Key, ["body"] = $"cc @{world.Member.Email}" }, cancellationToken: _ct);

        // Assert
        Assert.False(result.IsError == true);
        var dto = JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
        Assert.Equal(world.Member.Email, dto.GetProperty("mentions")[0].GetProperty("email").GetString());
        Assert.Equal([NotificationKind.Mentioned], (await api.StoredNotificationsAsync(world.Member)).Select(n => n.Kind));
        Assert.Equal(1, await api.WithDbAsync(db => db.DocWatchers.CountAsync(w => w.DocNodeId == page.Id && w.UserId == world.Member.Id)));
    }
}
