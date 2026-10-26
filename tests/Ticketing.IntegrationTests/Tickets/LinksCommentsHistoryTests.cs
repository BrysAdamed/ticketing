using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Comments;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Tickets;

[Collection(nameof(TicketsCollection))]
public sealed class LinksCommentsHistoryTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Links_show_on_both_sides_and_relates_to_is_an_unordered_pair()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var a = await client.CreateTicketAsync("WEB", "A");
        var b = await client.CreateTicketAsync("WEB", "B");

        // Act
        var created = await client.PostAsJsonAsync($"/api/v1/tickets/{b.Key}/links", new { targetKey = a.Key, type = "RelatesTo" }, _ct);
        var reverse = await client.PostAsJsonAsync($"/api/v1/tickets/{a.Key}/links", new { targetKey = b.Key, type = "RelatesTo" }, _ct);
        var self = await client.PostAsJsonAsync($"/api/v1/tickets/{a.Key}/links", new { targetKey = a.Key, type = "Blocks" }, _ct);
        var missing = await client.PostAsJsonAsync($"/api/v1/tickets/{a.Key}/links", new { targetKey = "WEB-99", type = "Blocks" }, _ct);

        // Assert
        var link = await created.ReadAsync<TicketLinkDto>(HttpStatusCode.Created);
        Assert.Equal(("relates to", a.Key), (link.Label, link.Ticket.Key));
        await reverse.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.LinkExists);
        await self.ShouldBeProblemAsync(HttpStatusCode.BadRequest, TicketErrors.LinkSelf);
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
        Assert.Equal(b.Key, Assert.Single((await client.GetTicketAsync(a.Key)).Links!).Ticket.Key);
    }

    [Fact]
    public async Task Links_to_unreadable_projects_cannot_be_created_and_stay_hidden()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        await ownerClient.CreateProjectAsync("SECRET");
        var open = await ownerClient.CreateProjectAsync("OPEN", ProjectVisibility.Public);
        var secret = await ownerClient.CreateTicketAsync("SECRET", "Hidden");
        var visible = await ownerClient.CreateTicketAsync("OPEN", "Visible");
        await (await ownerClient.PostAsJsonAsync($"/api/v1/tickets/{visible.Key}/links", new { targetKey = secret.Key, type = "Blocks" }, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var outsiderView = await outsider.GetTicketAsync(visible.Key);
        var outsiderHistory = await (await outsider.GetAsync($"/api/v1/tickets/{visible.Key}/history", _ct)).ReadAsync<TicketHistoryPage>();
        var outsiderLink = await outsider.PostAsJsonAsync($"/api/v1/tickets/{visible.Key}/links", new { targetKey = secret.Key, type = "RelatesTo" }, _ct);
        var ownerView = await ownerClient.GetTicketAsync(visible.Key);
        var outsiderUnlink = await outsider.DeleteAsync($"/api/v1/tickets/{visible.Key}/links/{ownerView.Links![0].Id}", _ct);

        // Assert
        Assert.Empty(outsiderView.Links!);
        Assert.DoesNotContain(outsiderHistory.Items, i => i.Action == "ticket.link.added");
        await outsiderLink.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
        await outsiderUnlink.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.LinkNotFound);
        Assert.Single(ownerView.Links);
        Assert.Equal(open.Id, ownerView.ProjectId);
    }

    [Fact]
    public async Task Unlink_removes_the_link_and_records_history()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var a = await client.CreateTicketAsync("WEB", "A");
        var b = await client.CreateTicketAsync("WEB", "B");
        var link = await (await client.PostAsJsonAsync($"/api/v1/tickets/{a.Key}/links", new { targetKey = b.Key, type = "Blocks" }, _ct))
            .ReadAsync<TicketLinkDto>(HttpStatusCode.Created);

        // Act
        var response = await client.DeleteAsync($"/api/v1/tickets/{b.Key}/links/{link.Id}", _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        Assert.Empty((await client.GetTicketAsync(a.Key)).Links!);
        Assert.True(await api.WithDbAsync(db => db.ActivityEntries.AnyAsync(e => e.Action == "ticket.link.removed" && e.EntityId == b.Id, _ct)));
    }

    [Fact]
    public async Task Comments_are_listed_oldest_first_with_paging()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Task");
        foreach (var body in new[] { "one", "two", "three" })
            await (await client.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/comments", new { body }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var first = await (await client.GetAsync($"/api/v1/tickets/{ticket.Key}/comments?limit=2", _ct)).ReadAsync<CursorPage<CommentDto>>();
        var second = await (await client.GetAsync($"/api/v1/tickets/{ticket.Key}/comments?limit=2&cursor={first.NextCursor}", _ct)).ReadAsync<CursorPage<CommentDto>>();
        var empty = await client.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/comments", new { body = "  " }, _ct);

        // Assert
        Assert.Equal(["one", "two"], first.Items.Select(c => c.Body));
        Assert.Equal(["three"], second.Items.Select(c => c.Body));
        Assert.Null(second.NextCursor);
        Assert.All(first.Items, c => Assert.True(c.CanEdit && c.CanDelete));
        await empty.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
    }

    [Fact]
    public async Task Authors_edit_and_delete_their_comments_owners_moderate_members_cannot()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var project = await ownerClient.CreateProjectAsync("WEB");
        var memberUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, memberUser, ProjectRole.Member);
        var member = await api.LoginAsync(memberUser);
        var ticket = await ownerClient.CreateTicketAsync("WEB", "Task");
        var ownerComment = await (await ownerClient.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/comments", new { body = "Owner says" }, _ct))
            .ReadAsync<CommentDto>(HttpStatusCode.Created);
        var memberComment = await (await member.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/comments", new { body = "Member says" }, _ct))
            .ReadAsync<CommentDto>(HttpStatusCode.Created);

        // Act
        var memberEditsOwner = await member.PatchAsJsonAsync($"/api/v1/comments/{ownerComment.Id}", new { body = "Hijack" }, _ct);
        var memberDeletesOwner = await member.DeleteAsync($"/api/v1/comments/{ownerComment.Id}", _ct);
        var memberEditsOwn = await member.PatchAsJsonAsync($"/api/v1/comments/{memberComment.Id}", new { body = "Member says, edited" }, _ct);
        var ownerDeletesMember = await ownerClient.DeleteAsync($"/api/v1/comments/{memberComment.Id}", _ct);
        var editDeleted = await member.PatchAsJsonAsync($"/api/v1/comments/{memberComment.Id}", new { body = "Again" }, _ct);

        // Assert
        await memberEditsOwner.ShouldBeProblemAsync(HttpStatusCode.Forbidden, CommentErrors.NotAuthor);
        await memberDeletesOwner.ShouldBeProblemAsync(HttpStatusCode.Forbidden, CommentErrors.NotAuthor);
        var edited = await memberEditsOwn.ReadAsync<CommentDto>();
        Assert.NotNull(edited.EditedAt);
        var placeholder = await ownerDeletesMember.ReadAsync<CommentDto>();
        Assert.Equal((true, string.Empty), (placeholder.Deleted, placeholder.Body));
        await editDeleted.ShouldBeProblemAsync(HttpStatusCode.Conflict, CommentErrors.Deleted);
        var history = await (await ownerClient.GetAsync($"/api/v1/tickets/{ticket.Key}/history", _ct)).ReadAsync<TicketHistoryPage>();
        var edit = Assert.Single(history.Items, i => i.Action == "comment.edited");
        Assert.Equal("Member says", edit.OldValue!.Value.GetProperty("body").GetString());
        var comments = await (await ownerClient.GetAsync($"/api/v1/tickets/{ticket.Key}/comments", _ct)).ReadAsync<CursorPage<CommentDto>>();
        Assert.Equal([false, true], comments.Items.Select(c => c.Deleted));
    }

    [Fact]
    public async Task Viewers_read_comments_but_cannot_add_them()
    {
        // Arrange
        var ownerClient = await api.LoginAsync(await api.CreateUserAsync());
        var project = await ownerClient.CreateProjectAsync("WEB");
        var viewerUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewerUser, ProjectRole.Viewer);
        var viewer = await api.LoginAsync(viewerUser);
        var ticket = await ownerClient.CreateTicketAsync("WEB", "Task");
        await (await ownerClient.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/comments", new { body = "Hello" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var list = await (await viewer.GetAsync($"/api/v1/tickets/{ticket.Key}/comments", _ct)).ReadAsync<CursorPage<CommentDto>>();
        var add = await viewer.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/comments", new { body = "Me too" }, _ct);

        // Assert
        Assert.False(Assert.Single(list.Items).CanDelete);
        await add.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
    }

    [Fact]
    public async Task History_is_newest_first_paged_and_resolves_assignees()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Task");
        await client.PatchTicketAsync(ticket.Key, new { assignee = "me" });
        await client.PatchTicketAsync(ticket.Key, new { status = "InProgress", priority = "High" });

        // Act
        var first = await (await client.GetAsync($"/api/v1/tickets/{ticket.Key}/history?limit=2", _ct)).ReadAsync<TicketHistoryPage>();
        var rest = await (await client.GetAsync($"/api/v1/tickets/{ticket.Key}/history?cursor={first.NextCursor}", _ct)).ReadAsync<TicketHistoryPage>();

        // Assert
        Assert.Equal(["priority", "status"], first.Items.Select(i => i.Field).Order());
        Assert.Equal(["ticket.field.changed", "ticket.created"], rest.Items.Select(i => i.Action));
        var assignee = rest.Items[0];
        Assert.Equal((JsonValueKind.Null, user.Id.ToString()), (assignee.OldValue?.ValueKind ?? JsonValueKind.Null, assignee.NewValue!.Value.GetString()));
        Assert.Equal(user.Id, Assert.Single(rest.Users).Id);
        Assert.Equal(Domain.Activity.WriteChannel.Web, assignee.Channel);
    }
}
