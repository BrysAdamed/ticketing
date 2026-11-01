using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Protocol;
using Npgsql;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Mentions;
using Ticketing.IntegrationTests.Notifications;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Whoever publishes or restores a version of a page or diagram starts watching it (TKT-119, D-178).</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocPublisherWatchTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Publishing_a_page_makes_the_publisher_a_watcher_and_co_authors_hear_about_each_other()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPA");
        var page = await world.OwnerClient.CreatePageAsync("DPA", "Design", content: "v1");

        // Act
        (await world.MemberClient.PatchDocAsync(page.Key, new { content = "v2", baseVersion = 1 })).EnsureSuccessStatusCode();
        (await world.MemberClient.PatchDocAsync(page.Key, new { content = "v3", baseVersion = 2 })).EnsureSuccessStatusCode();
        var watchers = await world.MemberClient.DocWatchersAsync(page.Key);
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v4", baseVersion = 3 })).EnsureSuccessStatusCode();

        // Assert
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), watchers.Ids().OrderBy(id => id));
        Assert.True(watchers.Watching);
        Assert.Equal([(NotificationKind.DocUpdated, "published version 2", 2)], (await api.StoredNotificationsAsync(world.Owner)).Rows());
        Assert.Equal([(NotificationKind.DocUpdated, "published version 4", 1)], (await api.StoredNotificationsAsync(world.Member)).Rows());
        Assert.Equal(2, await api.WithDbAsync(db => db.DocWatchers.Where(w => w.DocNodeId == page.Id).CountAsync()));
    }

    [Fact]
    public async Task Find_and_replace_restores_and_diagram_versions_subscribe_too()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPB");
        var page = await world.OwnerClient.CreatePageAsync("DPB", "Plan", content: "Step 1");
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "Step 1\nStep 2", baseVersion = 1 })).EnsureSuccessStatusCode();
        var diagram = await world.OwnerClient.CreateDocAsync("DPB", new { kind = "Diagram", diagramFormat = "Mermaid", title = "Flow", content = "flowchart LR\n  a --> b" });
        var restorer = await api.CreateUserAsync();
        await api.AddMemberAsync(world.ProjectId, restorer, ProjectRole.Member);
        var restorerClient = await api.LoginAsync(restorer);

        // Act
        var edit = await world.MemberClient.PostAsJsonAsync(
            $"/api/v1/docs/{page.Key}/edits", new { edits = new[] { new { oldText = "Step 2", newText = "Step 2b" } } }, HttpAssertions.Json, _ct);
        var restore = await restorerClient.PostAsJsonAsync($"/api/v1/docs/{page.Key}/versions/1/restore", new { }, HttpAssertions.Json, _ct);
        var redraw = await world.MemberClient.PatchDocAsync(diagram.Key, new { content = "flowchart LR\n  a --> c", baseVersion = 1 });

        // Assert
        await edit.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await restore.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await redraw.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member, restorer), await StoredDocWatcherIdsAsync(page.Id));
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), await StoredDocWatcherIdsAsync(diagram.Id));
        Assert.Equal([(NotificationKind.DocUpdated, "restored version 1 as version 4", 1)], (await api.StoredNotificationsAsync(world.Member)).Rows());
    }

    [Fact]
    public async Task Publishing_over_mcp_subscribes_the_token_owner()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPC");
        var page = await world.OwnerClient.CreatePageAsync("DPC", "Via MCP", content: "PostgreSQL 17");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Member));

        // Act
        var result = await mcp.CallToolAsync("edit_doc", new Dictionary<string, object?>
        {
            ["docKey"] = page.Key, ["edits"] = new[] { new { oldText = "PostgreSQL 17", newText = "PostgreSQL 18" } },
        }, cancellationToken: _ct);

        // Assert
        Assert.False(result.IsError == true, (result.Content.FirstOrDefault() as TextContentBlock)?.Text);
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), await StoredDocWatcherIdsAsync(page.Id));
    }

    [Fact]
    public async Task Drafts_renames_and_denied_publishes_subscribe_nobody()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPD");
        var page = await world.OwnerClient.CreatePageAsync("DPD", "Notes", content: "v1");

        // Act
        var draft = await world.MemberClient.PutAsJsonAsync(
            $"/api/v1/docs/{page.Key}/draft", new { baseVersion = 1, title = "Notes", content = "work in progress" }, HttpAssertions.Json, _ct);
        var rename = await world.MemberClient.PatchDocAsync(page.Key, new { title = "Notes 2" });
        var denied = await world.ViewerClient.PatchDocAsync(page.Key, new { content = "v2", baseVersion = 1 });

        // Assert
        await draft.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await rename.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.Equal([world.Owner.Id], await StoredDocWatcherIdsAsync(page.Id));
    }

    [Fact]
    public async Task Unwatching_holds_until_the_next_publish_of_ones_own()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPE");
        var page = await world.OwnerClient.CreatePageAsync("DPE", "Living", content: "v1");
        (await world.MemberClient.PatchDocAsync(page.Key, new { content = "v2", baseVersion = 1 })).EnsureSuccessStatusCode();
        await world.MemberClient.UnwatchDocAsync(page.Key);

        // Act
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v3", baseVersion = 2 })).EnsureSuccessStatusCode();
        var whileUnwatched = await api.StoredNotificationsAsync(world.Member);
        (await world.MemberClient.PatchDocAsync(page.Key, new { content = "v4", baseVersion = 3 })).EnsureSuccessStatusCode();
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v5", baseVersion = 4 })).EnsureSuccessStatusCode();

        // Assert
        Assert.Empty(whileUnwatched);
        Assert.Equal([(NotificationKind.DocUpdated, "published version 5", 1)], (await api.StoredNotificationsAsync(world.Member)).Rows());
    }

    [Fact]
    public async Task A_publish_succeeds_while_the_publisher_starts_watching_in_another_transaction()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DPF");
        var page = await world.OwnerClient.CreatePageAsync("DPF", "Racy", content: "v1");
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var explicitWatch = await connection.BeginTransactionAsync(_ct);
        await using (var insert = new NpgsqlCommand(
            "INSERT INTO doc_watchers (doc_node_id, user_id, created_at) VALUES (@doc, @user, now())", connection, explicitWatch))
        {
            insert.Parameters.AddWithValue("doc", page.Id);
            insert.Parameters.AddWithValue("user", world.Member.Id);
            await insert.ExecuteNonQueryAsync(_ct);
        }

        // Act
        var publish = world.MemberClient.PatchDocAsync(page.Key, new { content = "v2", baseVersion = 1 });
        await api.UntilSomeoneWaitsAsync(_ct);
        await explicitWatch.CommitAsync(_ct);
        var response = await publish;

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), await StoredDocWatcherIdsAsync(page.Id));
    }

    private Task<List<Guid>> StoredDocWatcherIdsAsync(Guid docNodeId) =>
        api.WithDbAsync(db => db.DocWatchers.Where(w => w.DocNodeId == docNodeId).Select(w => w.UserId).OrderBy(id => id).ToListAsync());
}
