using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Notifications;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>A new doc comment notifies the doc's author and earlier commenters, never the actor (docs refinement D12, D-94).</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocCommentNotificationTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_author_and_earlier_commenters_are_notified_of_a_new_comment_but_never_the_actor()
    {
        // Arrange
        var world = await SeedAsync("NOTE");
        var page = await world.AuthorClient.CreatePageAsync("NOTE", "Design notes");

        // Act
        await world.FirstClient.AddDocCommentAsync(page.Key, "First!");
        await world.SecondClient.AddDocCommentAsync(page.Key, "Second");
        await world.AuthorClient.AddDocCommentAsync(page.Key, "Thanks both");

        // Assert
        var author = await api.StoredNotificationsAsync(world.Author);
        var first = await api.StoredNotificationsAsync(world.First);
        var second = await api.StoredNotificationsAsync(world.Second);
        var bystander = await api.StoredNotificationsAsync(world.Bystander);
        Assert.Equal(2, author.Count);
        Assert.All(author, n => Assert.Equal((NotificationKind.Commented, "commented", page.Id), (n.Kind, n.Summary, n.DocNodeId!.Value)));
        Assert.Equal([world.First.Id, world.Second.Id], author.Select(n => n.ActorId!.Value));
        Assert.Equal([world.Second.Id, world.Author.Id], first.Select(n => n.ActorId!.Value));
        Assert.Equal([world.Author.Id], second.Select(n => n.ActorId!.Value));
        Assert.Empty(bystander);
        Assert.All(author.Concat(first).Concat(second), n => Assert.Null(n.TicketId));
    }

    [Fact]
    public async Task Doc_comment_notifications_list_the_doc_and_link_to_its_comments()
    {
        // Arrange
        var world = await SeedAsync("LINK");
        var page = await world.AuthorClient.CreatePageAsync("LINK", "Release plan");

        // Act
        await world.FirstClient.AddDocCommentAsync(page.Key, "Date?");
        await world.FirstClient.AddDocCommentAsync(page.Key, "Also scope?");
        var listed = await world.AuthorClient.NotificationsAsync();
        (await world.AuthorClient.DeleteAsync($"/api/v1/docs/{page.Key}", _ct)).EnsureSuccessStatusCode();
        var afterDelete = await world.AuthorClient.NotificationsAsync();

        // Assert
        var item = Assert.Single(listed.Items);
        Assert.Equal((NotificationKind.Commented, 2, "LINK"), (item.Kind, item.EventCount, item.ProjectKey));
        Assert.Equal((page.Key, "Release plan", false), (item.Doc!.Key, item.Doc.Title, item.Doc.Deleted));
        Assert.Null(item.Ticket);
        Assert.Null(item.Regression);
        Assert.Equal($"/p/LINK/docs/{page.Key}/release-plan#comments", item.Url);
        Assert.True(Assert.Single(afterDelete.Items).Doc!.Deleted);
    }

    [Fact]
    public async Task Participants_who_cannot_read_the_project_any_more_are_not_notified()
    {
        // Arrange
        var world = await SeedAsync("LEFT");
        var page = await world.FirstClient.CreatePageAsync("LEFT", "Handover");
        await world.SecondClient.AddDocCommentAsync(page.Key, "Taking over");
        (await world.AuthorClient.DeleteAsync($"/api/v1/projects/LEFT/members/{world.First.Id}", _ct)).EnsureSuccessStatusCode();

        // Act
        await world.AuthorClient.AddDocCommentAsync(page.Key, "Welcome");

        // Assert
        Assert.Equal([world.Second.Id], (await api.StoredNotificationsAsync(world.First)).Select(n => n.ActorId!.Value));
        Assert.Equal([world.Author.Id], (await api.StoredNotificationsAsync(world.Second)).Select(n => n.ActorId!.Value));
    }

    [Fact]
    public async Task Authors_of_only_deleted_comments_drop_out_and_edits_and_deletes_notify_nobody()
    {
        // Arrange
        var world = await SeedAsync("QUIT");
        var page = await world.AuthorClient.CreatePageAsync("QUIT", "Plan");
        var withdrawn = await world.FirstClient.AddDocCommentAsync(page.Key, "Never mind");
        (await world.FirstClient.DeleteDocCommentAsync(withdrawn.Id)).EnsureSuccessStatusCode();
        var edited = await world.SecondClient.AddDocCommentAsync(page.Key, "Typo");
        var before = await api.NotificationCountAsync();

        // Act
        (await world.SecondClient.PatchDocCommentAsync(edited.Id, "Fixed")).EnsureSuccessStatusCode();
        var afterEdit = await api.NotificationCountAsync();
        await world.AuthorClient.AddDocCommentAsync(page.Key, "Noted");

        // Assert
        Assert.Equal(before, afterEdit);
        Assert.Empty(await api.StoredNotificationsAsync(world.First));
        Assert.Single(await api.StoredNotificationsAsync(world.Second));
    }

    private async Task<World> SeedAsync(string key)
    {
        var author = await api.CreateUserAsync();
        var first = await api.CreateUserAsync();
        var second = await api.CreateUserAsync();
        var bystander = await api.CreateUserAsync();
        var authorClient = await api.LoginAsync(author);
        var project = await authorClient.CreateProjectAsync(key);
        await api.AddMemberAsync(project.Id, first, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, second, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, bystander, ProjectRole.Member);
        return new World(author, first, second, bystander, authorClient, await api.LoginAsync(first), await api.LoginAsync(second));
    }

    private sealed record World(
        TestUser Author, TestUser First, TestUser Second, TestUser Bystander, HttpClient AuthorClient, HttpClient FirstClient, HttpClient SecondClient);
}
