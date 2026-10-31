using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Docs;
using Ticketing.Domain.Collaboration;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Mentions;
using Ticketing.IntegrationTests.Notifications;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>@mentions in page content (I-86, D-96, D-164): checked and notified when a page is published, never for drafts, restores or duplicates.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocPageMentionTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Creating_a_page_with_a_mention_notifies_the_user_links_to_the_page_and_makes_them_watch()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPA");

        // Act
        var page = await world.OwnerClient.CreatePageAsync("DPA", "Owners", content: $"Section owner: @{world.Member.Email}\n\n`{world.Viewer.Mention()}`");
        var listed = await world.MemberClient.NotificationsAsync();

        // Assert
        Assert.Equal($"Section owner: {world.Member.Mention()}\n\n`{world.Viewer.Mention()}`", page.Content);
        Assert.Equal([world.Member.Id], page.Mentions.Ids());
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you on the page", 1)], (await api.StoredNotificationsAsync(world.Member)).Rows());
        Assert.Empty(await api.StoredNotificationsAsync(world.Viewer));
        Assert.Empty(await api.StoredNotificationsAsync(world.Owner));
        Assert.Equal($"/p/DPA/docs/{page.Key}/owners", Assert.Single(listed.Items).Url);
        Assert.True((await world.MemberClient.DocWatchersAsync(page.Key)).Watching);
    }

    [Fact]
    public async Task Republishing_notifies_only_newly_added_mentions_for_updates_and_find_replace_edits()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPB");
        var page = await world.OwnerClient.CreatePageAsync("DPB", "Plan", content: $"Ask {world.Member.Mention()}");
        await api.ClearNotificationsAsync();

        // Act
        var same = await world.OwnerClient.PatchDocAsync(page.Key, new { content = $"Ask {world.Member.Mention()} first", baseVersion = 1 });
        var edit = await world.OwnerClient.PostAsJsonAsync(
            $"/api/v1/docs/{page.Key}/edits", new { edits = new[] { new { oldText = "first", newText = $"and {world.Viewer.Mention()}" } } }, HttpAssertions.Json, _ct);

        // Assert
        await same.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await edit.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you on the page", 1)], (await api.StoredNotificationsAsync(world.Viewer)).Rows());
        Assert.Equal([world.Member.Id, world.Viewer.Id], (await world.OwnerClient.GetDocAsync(page.Key)).Mentions.Ids());
    }

    [Fact]
    public async Task A_new_mention_of_someone_who_cannot_read_the_project_fails_but_an_old_one_never_blocks_a_publish()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPC");
        var outsider = await api.CreateUserAsync(displayName: "Outsider Olga");
        var page = await world.OwnerClient.CreatePageAsync("DPC", "Handover", content: $"Thanks {world.Member.Mention()}");
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/DPC/members/{world.Member.Id}", _ct)).EnsureSuccessStatusCode();

        // Act
        var create = await world.OwnerClient.PostAsJsonAsync(
            "/api/v1/projects/DPC/docs", new { kind = "Page", title = "Leak", content = outsider.Mention() }, HttpAssertions.Json, _ct);
        var update = await world.OwnerClient.PatchDocAsync(page.Key, new { content = $"Thanks {world.Member.Mention()} and @{outsider.Email}", baseVersion = 1 });
        var keepOld = await world.OwnerClient.PatchDocAsync(page.Key, new { content = $"Thanks {world.Member.Mention()}!", baseVersion = 1 });
        var doc = await world.OwnerClient.GetDocAsync(page.Key);

        // Assert
        var problem = await create.ShouldBeProblemAsync(HttpStatusCode.BadRequest, CollaborationErrors.MentionInvalid);
        Assert.True(problem.GetProperty("errors").TryGetProperty("content", out _));
        await update.ShouldBeProblemAsync(HttpStatusCode.BadRequest, CollaborationErrors.MentionInvalid);
        await keepOld.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(2, doc.Version);
        Assert.Empty(doc.Mentions);
        Assert.Empty(await api.StoredNotificationsAsync(outsider));
    }

    [Fact]
    public async Task Drafts_restores_duplicates_and_diagrams_neither_check_nor_notify_mentions()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPD");
        var page = await world.OwnerClient.CreatePageAsync("DPD", "Notes", content: $"Hi {world.Member.Mention()}");
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "Nobody", baseVersion = 1 })).EnsureSuccessStatusCode();
        await api.ClearNotificationsAsync();

        // Act
        var draft = await world.OwnerClient.PutAsJsonAsync(
            $"/api/v1/docs/{page.Key}/draft", new { baseVersion = 2, title = "Notes", content = $"Hi {world.Viewer.Mention()}" }, HttpAssertions.Json, _ct);
        var restore = await world.OwnerClient.PostAsJsonAsync($"/api/v1/docs/{page.Key}/versions/1/restore", new { }, HttpAssertions.Json, _ct);
        var duplicate = await world.OwnerClient.PostAsJsonAsync($"/api/v1/docs/{page.Key}/duplicate", new { }, HttpAssertions.Json, _ct);
        var diagram = await world.OwnerClient.CreateDocAsync("DPD", new { kind = "Diagram", diagramFormat = "Mermaid", title = "Flow", content = $"flowchart LR\n  a[{world.Viewer.Mention()}] --> b" });

        // Assert
        await draft.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await restore.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await duplicate.ShouldHaveStatusAsync(HttpStatusCode.Created);
        Assert.Empty(diagram.Mentions);
        Assert.Equal(0, await api.NotificationCountAsync());
        Assert.Equal([world.Member.Id], (await world.OwnerClient.GetDocAsync(page.Key)).Mentions.Ids());
    }

    [Fact]
    public async Task An_older_version_reports_its_own_mentions()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPE");
        var page = await world.OwnerClient.CreatePageAsync("DPE", "History", content: $"v1 {world.Member.Mention()}");
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = $"v2 {world.Viewer.Mention()}", baseVersion = 1 })).EnsureSuccessStatusCode();

        // Act
        var first = await (await world.OwnerClient.GetAsync($"/api/v1/docs/{page.Key}?version=1", _ct)).ReadAsync<DocDto>();
        var latest = await world.OwnerClient.GetDocAsync(page.Key);

        // Assert
        Assert.Equal([world.Member.Id], first.Mentions.Ids());
        Assert.Equal([world.Viewer.Id], latest.Mentions.Ids());
    }

    [Fact]
    public async Task Page_mentions_work_over_mcp()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPF");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Owner));

        // Act
        var result = await mcp.CallToolAsync(
            "create_page",
            new Dictionary<string, object?> { ["projectKey"] = "DPF", ["title"] = "Via MCP", ["content"] = $"Reviewer: @{world.Member.Email}" },
            cancellationToken: _ct);

        // Assert
        Assert.False(result.IsError == true, (result.Content.FirstOrDefault() as TextContentBlock)?.Text);
        var dto = JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
        Assert.Equal(world.Member.Email, dto.GetProperty("mentions")[0].GetProperty("email").GetString());
        Assert.Equal([NotificationKind.Mentioned], (await api.StoredNotificationsAsync(world.Member)).Select(n => n.Kind));
        Assert.Equal(1, await api.WithDbAsync(db => db.DocWatchers.CountAsync(w => w.UserId == world.Member.Id)));
    }
}
