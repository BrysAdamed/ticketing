using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Backlog;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Projects;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Tickets;

[Collection(nameof(TicketsCollection))]
public sealed class RestoreTicketTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Restore_brings_back_parent_links_test_cases_and_board_placement()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        var epic = await client.CreateTicketAsync("WEB", "Epic", "Epic");
        var ticket = await client.CreateTicketAsync("WEB", "Restore me", extra: new { parentKey = epic.Key });
        var blocked = await client.CreateTicketAsync("WEB", "Blocked");
        var related = await client.CreateTicketAsync("WEB", "Related");
        await LinkAsync(client, ticket.Key, blocked.Key, "Blocks");
        await LinkAsync(client, related.Key, ticket.Key, "RelatesTo");
        var testCaseId = await AddTestCaseAsync(project.Id, owner.Id, ticket.Id);
        var boardId = await api.CreateBoardAsync(owner.Id, project.Id);
        await api.PlaceOnBoardAsync(blocked.Id, boardId, "a0");
        await api.PlaceOnBoardAsync(ticket.Id, boardId, "a5");
        await (await client.DeleteAsync($"/api/v1/tickets/{ticket.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

        // Act
        var response = await client.PostAsync($"/api/v1/tickets/{ticket.Key}/restore", null, _ct);

        // Assert
        var restored = await response.ReadAsync<TicketDto>();
        Assert.Equal($"\"{restored.RowVersion}\"", response.Headers.ETag?.Tag);
        Assert.Equal((TicketLocationKind.Board, boardId), (restored.Location.Kind, restored.Location.BoardId!.Value));
        Assert.Equal(epic.Key, restored.Parent!.Key);
        Assert.Equal(
            [("blocks", blocked.Key), ("relates to", related.Key)],
            restored.Links!.Select(l => (l.Label, l.Ticket.Key)).OrderBy(l => l.Item1));
        Assert.Equal(testCaseId, Assert.Single(restored.TestCases!).Id);
        Assert.Equal("a5", await api.WithDbAsync(db => db.Tickets.Where(t => t.Id == ticket.Id).Select(t => t.Rank).SingleAsync(_ct)));
        Assert.Single((await client.GetTicketAsync(related.Key)).Links!);
        var get = await client.GetAsync($"/api/v1/tickets/{ticket.Key}", _ct);
        await get.ShouldHaveStatusAsync(HttpStatusCode.OK);
        var history = await (await client.GetAsync($"/api/v1/tickets/{ticket.Key}/history", _ct)).ReadAsync<TicketHistoryPage>();
        Assert.Equal([RestoreTicket.Action, DeleteTicket.Action], history.Items.Take(2).Select(i => i.Action));
        var deletion = history.Items[1].NewValue!.Value;
        Assert.Equal(["key", "boardId"], deletion.EnumerateObject().Select(p => p.Name));
        Assert.Equal(boardId, deletion.GetProperty("boardId").GetGuid());
        var restoredEntry = history.Items[0].NewValue!.Value;
        Assert.Equal((2, 1), (restoredEntry.GetProperty("links").GetInt32(), restoredEntry.GetProperty("testCases").GetInt32()));
    }

    [Fact]
    public async Task Restore_goes_to_the_backlog_top_when_the_board_was_archived()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        await client.CreateTicketAsync("WEB", "Backlog work");
        var ticket = await client.CreateTicketAsync("WEB", "On the board");
        var boardId = await api.CreateBoardAsync(owner.Id, project.Id);
        await api.PlaceOnBoardAsync(ticket.Id, boardId);
        await (await client.DeleteAsync($"/api/v1/tickets/{ticket.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await api.WithDbAsync(async db =>
        {
            (await db.Boards.SingleAsync(b => b.Id == boardId, _ct)).Archive(owner.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var restored = await (await client.PostAsync($"/api/v1/tickets/{ticket.Key}/restore", null, _ct)).ReadAsync<TicketDto>();

        // Assert
        Assert.Equal(TicketLocationKind.Backlog, restored.Location.Kind);
        var backlog = await (await client.GetAsync("/api/v1/projects/WEB/backlog", _ct)).ReadAsync<BacklogDto>();
        Assert.Equal([ticket.Key, "WEB-1"], backlog.Items.Select(i => i.Key));
    }

    [Fact]
    public async Task Restore_into_the_backlog_keeps_the_original_rank_unless_another_ticket_took_it()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        await client.CreateProjectAsync("WEB");
        var first = await client.CreateTicketAsync("WEB", "First");
        var middle = await client.CreateTicketAsync("WEB", "Middle");
        var last = await client.CreateTicketAsync("WEB", "Last");
        var taken = await client.CreateTicketAsync("WEB", "Taken");
        await (await client.DeleteAsync($"/api/v1/tickets/{middle.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await (await client.DeleteAsync($"/api/v1/tickets/{last.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await api.WithDbAsync(async db =>
        {
            var lastRank = await db.Tickets.Where(t => t.Id == last.Id).Select(t => t.Rank).SingleAsync(_ct);
            return await db.Tickets.Where(t => t.Id == taken.Id).ExecuteUpdateAsync(s => s.SetProperty(t => t.Rank, lastRank), _ct);
        });

        // Act
        await (await client.PostAsync($"/api/v1/tickets/{middle.Key}/restore", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await client.PostAsync($"/api/v1/tickets/{last.Key}/restore", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Assert
        var backlog = await (await client.GetAsync("/api/v1/projects/WEB/backlog", _ct)).ReadAsync<BacklogDto>();
        Assert.Equal([last.Key, first.Key, middle.Key, taken.Key], backlog.Items.Select(i => i.Key));
    }

    [Fact]
    public async Task Restore_skips_what_is_gone_and_clears_a_deleted_parent()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        var parent = await client.CreateTicketAsync("WEB", "Parent");
        var ticket = await client.CreateTicketAsync("WEB", "Restore me", extra: new { parentKey = parent.Key });
        var gone = await client.CreateTicketAsync("WEB", "Gone");
        await LinkAsync(client, ticket.Key, gone.Key, "Duplicates");
        var testCaseId = await AddTestCaseAsync(project.Id, owner.Id, ticket.Id);
        var other = await client.CreateTicketAsync("WEB", "Other");
        await (await client.DeleteAsync($"/api/v1/tickets/{ticket.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await (await client.DeleteAsync($"/api/v1/tickets/{parent.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await (await client.DeleteAsync($"/api/v1/tickets/{gone.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await api.WithDbAsync(db => db.TestCases.Where(c => c.Id == testCaseId).ExecuteUpdateAsync(s => s.SetProperty(c => c.TicketId, other.Id), _ct));

        // Act
        var restored = await (await client.PostAsync($"/api/v1/tickets/{ticket.Key}/restore", null, _ct)).ReadAsync<TicketDto>();

        // Assert
        Assert.Null(restored.Parent);
        Assert.Empty(restored.Links!);
        Assert.Empty(restored.TestCases!);
        Assert.Equal(other.Id, await api.WithDbAsync(db => db.TestCases.Where(c => c.Id == testCaseId).Select(c => c.TicketId).SingleAsync(_ct)));
    }

    [Fact]
    public async Task Restore_fails_when_the_ticket_is_not_deleted_or_the_window_has_passed()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var alive = await client.CreateTicketAsync("WEB", "Alive");
        var old = await client.CreateTicketAsync("WEB", "Deleted long ago");
        await (await client.DeleteAsync($"/api/v1/tickets/{old.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        var deletedAt = DateTimeOffset.UtcNow - Ticket.RestoreWindow - TimeSpan.FromMinutes(1);
        await api.WithDbAsync(db => db.Tickets.Where(t => t.Id == old.Id).ExecuteUpdateAsync(s => s.SetProperty(t => t.DeletedAt, deletedAt), _ct));

        // Act
        var notDeleted = await client.PostAsync($"/api/v1/tickets/{alive.Key}/restore", null, _ct);
        var expired = await client.PostAsync($"/api/v1/tickets/{old.Id}/restore", null, _ct);

        // Assert
        await notDeleted.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.NotDeleted);
        await expired.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.RestoreExpired);
        await (await client.GetAsync($"/api/v1/tickets/{old.Key}", _ct)).ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.Deleted);
    }

    [Fact]
    public async Task Restore_is_owner_only_and_private_projects_are_404_for_outsiders()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var privateProject = await client.CreateProjectAsync("PRIV");
        await client.CreateProjectAsync("OPEN", ProjectVisibility.Public);
        var privateTicket = await client.CreateTicketAsync("PRIV", "Secret");
        var publicTicket = await client.CreateTicketAsync("OPEN", "Open");
        var memberUser = await api.CreateUserAsync();
        await api.AddMemberAsync(privateProject.Id, memberUser, ProjectRole.Member);
        var viewerUser = await api.CreateUserAsync();
        await api.AddMemberAsync(privateProject.Id, viewerUser, ProjectRole.Viewer);
        var member = await api.LoginAsync(memberUser);
        var viewer = await api.LoginAsync(viewerUser);
        var outsider = await api.LoginAsync(await api.CreateUserAsync());
        await (await client.DeleteAsync($"/api/v1/tickets/{privateTicket.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await (await client.DeleteAsync($"/api/v1/tickets/{publicTicket.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

        // Act
        var byMember = await member.PostAsync($"/api/v1/tickets/{privateTicket.Key}/restore", null, _ct);
        var byViewer = await viewer.PostAsync($"/api/v1/tickets/{privateTicket.Key}/restore", null, _ct);
        var byOutsider = await outsider.PostAsync($"/api/v1/tickets/{privateTicket.Key}/restore", null, _ct);
        var byOutsiderById = await outsider.PostAsync($"/api/v1/tickets/{privateTicket.Id}/restore", null, _ct);
        var publicByOutsider = await outsider.PostAsync($"/api/v1/tickets/{publicTicket.Key}/restore", null, _ct);
        var byOwner = await client.PostAsync($"/api/v1/tickets/{privateTicket.Key}/restore", null, _ct);
        var publicByOwner = await client.PostAsync($"/api/v1/tickets/{publicTicket.Key}/restore", null, _ct);

        // Assert
        await byMember.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await byViewer.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await byOutsider.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
        await byOutsiderById.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
        await publicByOutsider.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        Assert.Equal(privateTicket.Key, (await byOwner.ReadAsync<TicketDto>()).Key);
        Assert.Equal(publicTicket.Key, (await publicByOwner.ReadAsync<TicketDto>()).Key);
        Assert.Equal(privateTicket.Key, (await member.GetTicketAsync(privateTicket.Key)).Key);
    }

    [Fact]
    public async Task Restore_in_an_archived_project_is_rejected()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Task");
        await (await client.DeleteAsync($"/api/v1/tickets/{ticket.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await (await client.PostAsync("/api/v1/projects/WEB/archive", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var response = await client.PostAsync($"/api/v1/tickets/{ticket.Key}/restore", null, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
    }

    private static async Task LinkAsync(HttpClient client, string sourceKey, string targetKey, string type) =>
        await (await client.PostAsJsonAsync($"/api/v1/tickets/{sourceKey}/links", new { targetKey, type })).ShouldHaveStatusAsync(HttpStatusCode.Created);

    private Task<Guid> AddTestCaseAsync(Guid projectId, Guid ownerId, Guid ticketId) =>
        api.WithDbAsync(async db =>
        {
            var number = await db.TestCases.CountAsync(c => c.ProjectId == projectId, _ct) + 1;
            var testCase = TestCase.Create(projectId, number, $"Case {number}", ownerId, DateTimeOffset.UtcNow);
            testCase.LinkTicket(ticketId);
            db.TestCases.Add(testCase);
            await db.SaveChangesAsync(_ct);
            return testCase.Id;
        });
}
