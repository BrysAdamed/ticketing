using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Backlog;
using Ticketing.Application.Boards;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Boards;

[Collection(nameof(BoardsCollection))]
public sealed class BoardEndpointTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Create_links_projects_makes_the_caller_owner_and_returns_all_eight_columns()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        await client.CreateProjectAsync("WEB");
        await client.CreateProjectAsync("API");

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/boards", new { name = " Sprint 1 ", description = "Goal", projectKeys = new[] { "web", "API", "WEB" } }, _ct);
        var board = await response.ReadAsync<BoardDto>(HttpStatusCode.Created);

        // Assert
        Assert.Equal(($"/api/v1/boards/{board.Id}", "Sprint 1", owner.Id), (response.Headers.Location?.OriginalString, board.Name, board.Owner.Id));
        Assert.Equal(["API", "WEB"], board.Projects.Select(p => p.Key));
        Assert.All(board.Projects, p => Assert.True(p.CanWrite));
        Assert.Equal(Enum.GetValues<TicketStatus>(), board.Columns.Select(c => c.Status));
        Assert.Equal(StatusCategory.InProgress, board.Columns.Single(c => c.Status == TicketStatus.Review).Category);
        Assert.True(board.Permissions.CanManage);
        var created = await api.WithDbAsync(db => db.ActivityEntries.SingleAsync(a => a.EntityId == board.Id, _ct));
        Assert.Equal((ActivityEntityType.Board, "board.created", WriteChannel.Web), (created.EntityType, created.Action, created.Channel));
    }

    [Fact]
    public async Task Create_validates_shape_and_needs_write_access_to_every_project()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var project = await ownerClient.CreateProjectAsync("WEB");
        var viewer = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewer, ProjectRole.Viewer);
        var viewerClient = await api.LoginAsync(viewer);
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var invalid = await ownerClient.PostAsJsonAsync("/api/v1/boards", new { name = "", projectKeys = Array.Empty<string>() }, _ct);
        var asViewer = await viewerClient.PostAsJsonAsync("/api/v1/boards", new { name = "B", projectKeys = new[] { "WEB" } }, _ct);
        var asOutsider = await outsider.PostAsJsonAsync("/api/v1/boards", new { name = "B", projectKeys = new[] { "WEB" } }, _ct);

        // Assert
        var problem = await invalid.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.Validation);
        Assert.True(problem.GetProperty("errors").TryGetProperty("name", out _));
        Assert.True(problem.GetProperty("errors").TryGetProperty("projectKeys", out _));
        await asViewer.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await asOutsider.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
    }

    [Fact]
    public async Task List_filters_by_query_project_owner_and_archive_state_with_visible_counts()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        await client.CreateProjectAsync("WEB");
        await client.CreateProjectAsync("API");
        var alpha = await client.CreateBoardAsync("Alpha", "WEB");
        var beta = await client.CreateBoardAsync("Beta", "API");
        var gamma = await client.CreateBoardAsync("Gamma", "WEB", "API");
        var other = await api.LoginAsync(await api.CreateUserAsync());
        await other.CreateProjectAsync("OTH", ProjectVisibility.Public);
        await other.CreateBoardAsync("Delta", "OTH");
        var todo = await client.CreateTicketAsync("WEB", "To do");
        var doing = await client.CreateTicketAsync("WEB", "Doing");
        var done = await client.CreateTicketAsync("API", "Done", extra: new { status = "Done" });
        await client.MoveOkAsync(gamma.Id.ToString(), [todo.Key]);
        await client.MoveOkAsync(gamma.Id.ToString(), [doing.Key], "Review");
        await client.MoveOkAsync(gamma.Id.ToString(), [done.Key]);
        await (await client.PostAsJsonAsync($"/api/v1/boards/{beta.Id}/archive", new { carryOverTo = "backlog" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        async Task<CursorPage<BoardSummaryDto>> List(string query) =>
            await (await client.GetAsync($"/api/v1/boards{query}", _ct)).ReadAsync<CursorPage<BoardSummaryDto>>();

        // Act
        var all = await List("");
        var withArchived = await List("?includeArchived=true");
        var byProject = await List("?projectKey=api&includeArchived=true");
        var byName = await List("?query=AMM");
        var mine = await List("?mine=true");
        var paged = await List("?limit=2");
        var nextPage = await List($"?limit=2&cursor={paged.NextCursor}");

        // Assert
        Assert.Equal(["Alpha", "Delta", "Gamma"], all.Items.Select(b => b.Name));
        Assert.Equal(["Alpha", "Beta", "Delta", "Gamma"], withArchived.Items.Select(b => b.Name));
        Assert.NotNull(withArchived.Items.Single(b => b.Id == beta.Id).ArchivedAt);
        Assert.Equal(["Beta", "Gamma"], byProject.Items.Select(b => b.Name));
        Assert.Equal(["Gamma"], byName.Items.Select(b => b.Name));
        Assert.Equal(["Alpha", "Gamma"], mine.Items.Select(b => b.Name));
        Assert.Equal(["Alpha", "Delta"], paged.Items.Select(b => b.Name));
        Assert.Equal(["Gamma"], nextPage.Items.Select(b => b.Name));
        Assert.Null(nextPage.NextCursor);
        var gammaRow = all.Items.Single(b => b.Id == gamma.Id);
        Assert.Equal(new StatusCategoryCountsDto(1, 1, 1), gammaRow.Counts);
        Assert.Equal(["API", "WEB"], gammaRow.Projects.Select(p => p.Key));
        Assert.True(gammaRow.CanManage);
        Assert.False(all.Items.Single(b => b.Name == "Delta").CanManage);
        Assert.Equal(alpha.Owner.Id, gammaRow.Owner.Id);
    }

    [Fact]
    public async Task Get_returns_cards_per_column_in_rank_order_with_users_parents_and_grandparents()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        await client.CreateProjectAsync("WEB");
        var board = await client.CreateBoardAsync("Sprint", "WEB");
        var epic = await client.CreateTicketAsync("WEB", "Epic", "Epic");
        var story = await client.CreateTicketAsync("WEB", "Story", extra: new { parentKey = epic.Key });
        var task = await client.CreateTicketAsync("WEB", "Task", "Technical", new { parentKey = story.Key, assignee = "me", labels = new[] { "ui" }, storyPoints = 3 });
        var bug = await client.CreateTicketAsync("WEB", "Bug", "Bug", new { severity = "Major" });
        await client.MoveOkAsync(board.Id.ToString(), [task.Key, bug.Key], "InProgress");
        await client.MoveOkAsync(board.Id.ToString(), [story.Key]);

        // Act
        var fetched = await client.GetBoardAsync(board.Id);
        var onlyMine = await client.GetBoardAsync(board.Id, "?assignee=me&status=InProgress&status=Done");

        // Assert
        Assert.Equal(["ToDo: WEB-2", "InProgress: WEB-3, WEB-4"], fetched.Layout());
        var card = fetched.Columns[1].Cards[0];
        Assert.Equal(("WEB", TicketType.Technical, 3, owner.Id, story.Id), (card.ProjectKey, card.Type, card.StoryPoints!.Value, card.AssigneeId!.Value, card.ParentId!.Value));
        Assert.Equal(["ui"], card.Labels);
        Assert.Equal(Severity.Major, fetched.Columns[1].Cards[1].Severity);
        Assert.Equal(owner.Id, Assert.Single(fetched.Users).Id);
        var storyParent = fetched.Parents.Single(p => p.Id == story.Id);
        Assert.Equal(epic.Id, storyParent.ParentId);
        Assert.Equal(("WEB-1", TicketType.Epic), fetched.Parents.Where(p => p.Id == epic.Id).Select(p => (p.Key, p.Type)).Single());
        Assert.Equal(3, fetched.Projects.Single().CardCount);
        Assert.Equal([TicketStatus.InProgress, TicketStatus.Done], onlyMine.Columns.Select(c => c.Status));
        Assert.Equal(["InProgress: WEB-3"], onlyMine.Layout());
    }

    [Fact]
    public async Task Get_unknown_or_deleted_board_is_404()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var board = await client.CreateBoardAsync("Gone", "WEB");
        await (await client.DeleteAsync($"/api/v1/boards/{board.Id}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

        // Act
        var deleted = await client.GetAsync($"/api/v1/boards/{board.Id}", _ct);
        var unknown = await client.GetAsync($"/api/v1/boards/{Guid.NewGuid()}", _ct);

        // Assert
        await deleted.ShouldBeProblemAsync(HttpStatusCode.NotFound, BoardErrors.NotFound);
        await unknown.ShouldBeProblemAsync(HttpStatusCode.NotFound, BoardErrors.NotFound);
    }

    [Fact]
    public async Task Update_renames_links_and_transfers_ownership_and_only_owner_or_admin_may()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        await client.CreateProjectAsync("WEB", ProjectVisibility.Public);
        await client.CreateProjectAsync("API", ProjectVisibility.Public);
        var board = await client.CreateBoardAsync("Sprint", "WEB");
        var colleague = await api.CreateUserAsync();
        var colleagueClient = await api.LoginAsync(colleague);
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));

        // Act
        var forbidden = await colleagueClient.PatchBoardAsync(board.Id, new { name = "Mine now" });
        var updated = await (await client.PatchBoardAsync(board.Id, new { name = "Sprint 2", description = (string?)null, addProjectKeys = new[] { "API" }, owner = colleague.Email })).ReadAsync<BoardDto>();
        var formerOwner = await client.PatchBoardAsync(board.Id, new { name = "Back" });
        var byAdmin = await (await admin.PatchBoardAsync(board.Id, new { description = "Set by admin" })).ReadAsync<BoardDto>();
        var unknownOwner = await admin.PatchBoardAsync(board.Id, new { owner = "nobody@ticketing.test" });

        // Assert
        await forbidden.ShouldBeProblemAsync(HttpStatusCode.Forbidden, BoardErrors.NotOwner);
        Assert.Equal(("Sprint 2", colleague.Id), (updated.Name, updated.Owner.Id));
        Assert.Equal(["API", "WEB"], updated.Projects.Select(p => p.Key));
        Assert.False(updated.Permissions.CanManage);
        await formerOwner.ShouldBeProblemAsync(HttpStatusCode.Forbidden, BoardErrors.NotOwner);
        Assert.Equal("Set by admin", byAdmin.Description);
        await unknownOwner.ShouldBeProblemAsync(HttpStatusCode.BadRequest, BoardErrors.OwnerInvalid);
        var actions = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.EntityId == board.Id).Select(a => a.Action + ":" + a.Field).ToListAsync(_ct));
        Assert.Contains("board.field.changed:name", actions);
        Assert.Contains("board.field.changed:ownerId", actions);
        Assert.Contains("board.project.linked:", actions);
    }

    [Fact]
    public async Task Update_with_stale_if_match_is_a_concurrency_conflict()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var board = await client.CreateBoardAsync("Sprint", "WEB");
        await (await client.PatchBoardAsync(board.Id, new { name = "Changed" })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        using var request = new HttpRequestMessage(HttpMethod.Patch, $"/api/v1/boards/{board.Id}") { Content = JsonContent.Create(new { name = "Stale" }) };
        request.Headers.TryAddWithoutValidation("If-Match", $"\"{board.RowVersion}\"");

        // Act
        var response = await client.SendAsync(request, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, AppErrors.ConcurrencyConflict);
    }

    [Fact]
    public async Task Unlinking_a_project_sends_its_cards_to_the_backlog_top_in_board_order_and_keeps_the_last_project()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        await client.CreateProjectAsync("WEB");
        await client.CreateProjectAsync("API");
        var board = await client.CreateBoardAsync("Sprint", "WEB", "API");
        await client.CreateTicketAsync("WEB", "Stays in backlog");
        var first = await client.CreateTicketAsync("WEB", "First");
        var second = await client.CreateTicketAsync("WEB", "Second", extra: new { status = "Done" });
        var api1 = await client.CreateTicketAsync("API", "Other project");
        await client.MoveOkAsync(board.Id.ToString(), [first.Key, second.Key, api1.Key]);

        // Act
        var before = await client.GetBoardAsync(board.Id);
        var updated = await (await client.PatchBoardAsync(board.Id, new { removeProjectKeys = new[] { "WEB" } })).ReadAsync<BoardDto>();
        var lastOne = await client.PatchBoardAsync(board.Id, new { removeProjectKeys = new[] { "API" } });
        var backlog = await (await client.GetAsync("/api/v1/projects/WEB/backlog?showDone=true", _ct)).ReadAsync<BacklogDto>();

        // Assert
        Assert.Equal(2, before.Projects.Single(p => p.Key == "WEB").CardCount);
        Assert.Equal(["API-1"], updated.Keys());
        Assert.Equal(["API"], updated.Projects.Select(p => p.Key));
        await lastOne.ShouldBeProblemAsync(HttpStatusCode.Conflict, BoardErrors.ProjectsRequired);
        Assert.Equal(["WEB-2", "WEB-3", "WEB-1"], backlog.Items.Select(i => i.Key));
        var moves = await api.WithDbAsync(db => db.ActivityEntries.CountAsync(a => a.Action == "ticket.moved" && a.NewValue == null, _ct));
        Assert.Equal(2, moves);
    }

    [Fact]
    public async Task Archive_carries_open_tickets_to_another_board_or_backlog_and_keeps_done_ones()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        await client.CreateProjectAsync("WEB");
        await client.CreateProjectAsync("API");
        var sprint1 = await client.CreateBoardAsync("Sprint 1", "WEB", "API");
        var sprint2 = await client.CreateBoardAsync("Sprint 2", "WEB");
        var leftover = await client.CreateTicketAsync("WEB", "Already on sprint 2");
        await client.MoveOkAsync(sprint2.Id.ToString(), [leftover.Key]);
        var a = await client.CreateTicketAsync("WEB", "Open A");
        var b = await client.CreateTicketAsync("WEB", "Done B", extra: new { status = "Done" });
        var c = await client.CreateTicketAsync("API", "Open C");
        var d = await client.CreateTicketAsync("WEB", "Open D");
        await client.MoveOkAsync(sprint1.Id.ToString(), [a.Key, b.Key, c.Key]);
        await client.MoveOkAsync(sprint1.Id.ToString(), [d.Key], "Review");

        // Act
        var response = await client.PostAsJsonAsync($"/api/v1/boards/{sprint1.Id}/archive", new { carryOverTo = sprint2.Id }, _ct);
        var result = await response.ReadAsync<ArchiveBoardResultDto>();
        var target = await client.GetBoardAsync(sprint2.Id);
        var apiBacklog = await (await client.GetAsync("/api/v1/projects/API/backlog", _ct)).ReadAsync<BacklogDto>();
        var moveOnArchived = await client.MoveAsync(sprint1.Id.ToString(), [leftover.Key]);
        var moveOffArchived = await client.MoveAsync("backlog", [b.Key]);
        var renameArchived = await client.PatchBoardAsync(sprint1.Id, new { name = "x" });
        var archiveAgain = await client.PostAsJsonAsync($"/api/v1/boards/{sprint1.Id}/archive", new { carryOverTo = "backlog" }, _ct);

        // Assert
        Assert.NotNull(result.Board.ArchivedAt);
        Assert.Equal((sprint2.Id, 2, 1, 1), (result.CarriedOverToBoardId!.Value, result.MovedToBoard, result.MovedToBacklog, result.StayedDone));
        Assert.Equal(["Done: WEB-3"], result.Board.Layout());
        Assert.Equal(["ToDo: WEB-1, WEB-2", "Review: WEB-4"], target.Layout());
        Assert.Equal(["API-1"], apiBacklog.Items.Select(i => i.Key));
        await moveOnArchived.ShouldBeProblemAsync(HttpStatusCode.Conflict, BoardErrors.Archived);
        await moveOffArchived.ShouldBeProblemAsync(HttpStatusCode.Conflict, BoardErrors.Archived);
        await renameArchived.ShouldBeProblemAsync(HttpStatusCode.Conflict, BoardErrors.Archived);
        await archiveAgain.ShouldBeProblemAsync(HttpStatusCode.Conflict, BoardErrors.Archived);
    }

    [Fact]
    public async Task Archive_rejects_itself_an_archived_or_unknown_target_and_non_owners()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB", ProjectVisibility.Public);
        var board = await client.CreateBoardAsync("Sprint", "WEB");
        var archived = await client.CreateBoardAsync("Old", "WEB");
        await (await client.PostAsJsonAsync($"/api/v1/boards/{archived.Id}/archive", new { carryOverTo = "backlog" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var stranger = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var self = await client.PostAsJsonAsync($"/api/v1/boards/{board.Id}/archive", new { carryOverTo = board.Id }, _ct);
        var toArchived = await client.PostAsJsonAsync($"/api/v1/boards/{board.Id}/archive", new { carryOverTo = archived.Id }, _ct);
        var unknown = await client.PostAsJsonAsync($"/api/v1/boards/{board.Id}/archive", new { carryOverTo = Guid.NewGuid() }, _ct);
        var garbage = await client.PostAsJsonAsync($"/api/v1/boards/{board.Id}/archive", new { carryOverTo = "somewhere" }, _ct);
        var notOwner = await stranger.PostAsJsonAsync($"/api/v1/boards/{board.Id}/archive", new { carryOverTo = "backlog" }, _ct);

        // Assert
        await self.ShouldBeProblemAsync(HttpStatusCode.BadRequest, BoardErrors.CarryOverInvalid);
        await toArchived.ShouldBeProblemAsync(HttpStatusCode.BadRequest, BoardErrors.CarryOverInvalid);
        await unknown.ShouldBeProblemAsync(HttpStatusCode.BadRequest, BoardErrors.CarryOverInvalid);
        await garbage.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.Validation);
        await notOwner.ShouldBeProblemAsync(HttpStatusCode.Forbidden, BoardErrors.NotOwner);
        Assert.Null((await client.GetBoardAsync(board.Id)).ArchivedAt);
    }

    [Fact]
    public async Task Archive_moves_tickets_of_projects_the_owner_cannot_write_but_reports_only_visible_ones()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        await ownerClient.CreateProjectAsync("WEB");
        var colleague = await api.CreateUserAsync();
        var colleagueClient = await api.LoginAsync(colleague);
        var secret = await colleagueClient.CreateProjectAsync("SEC");
        await api.AddMemberAsync(secret.Id, owner, ProjectRole.Member);
        var board = await ownerClient.CreateBoardAsync("Shared", "WEB", "SEC");
        var hidden = await colleagueClient.CreateTicketAsync("SEC", "Private work");
        await colleagueClient.MoveOkAsync(board.Id.ToString(), [hidden.Key]);
        await api.WithDbAsync(async db =>
        {
            var membership = await db.ProjectMembers.SingleAsync(m => m.ProjectId == secret.Id && m.UserId == owner.Id, _ct);
            db.ProjectMembers.Remove(membership);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var result = await (await ownerClient.PostAsJsonAsync($"/api/v1/boards/{board.Id}/archive", new { carryOverTo = "backlog" }, _ct)).ReadAsync<ArchiveBoardResultDto>();
        var secBacklog = await (await colleagueClient.GetAsync("/api/v1/projects/SEC/backlog", _ct)).ReadAsync<BacklogDto>();

        // Assert
        Assert.Equal((0, 0, 0), (result.MovedToBoard, result.MovedToBacklog, result.StayedDone));
        Assert.Equal(["SEC-1"], secBacklog.Items.Select(i => i.Key));
        var moved = await api.WithDbAsync(db => db.ActivityEntries.SingleAsync(a => a.EntityId == hidden.Id && a.Action == "ticket.moved" && a.NewValue == null, _ct));
        Assert.Equal(owner.Id, moved.ActorId);
    }

    [Fact]
    public async Task Unarchive_makes_the_board_writable_again()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var board = await client.CreateBoardAsync("Sprint", "WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Later");
        await (await client.PostAsJsonAsync($"/api/v1/boards/{board.Id}/archive", new { carryOverTo = "backlog" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var unarchived = await (await client.PostAsync($"/api/v1/boards/{board.Id}/unarchive", null, _ct)).ReadAsync<BoardDto>();
        var moved = await client.MoveOkAsync(board.Id.ToString(), [ticket.Key]);

        // Assert
        Assert.Null(unarchived.ArchivedAt);
        Assert.Equal(board.Id, moved[0].Location.BoardId);
    }

    [Fact]
    public async Task Delete_sends_every_ticket_including_done_to_the_backlog_top_and_hides_the_board()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var board = await client.CreateBoardAsync("Sprint", "WEB");
        await client.CreateTicketAsync("WEB", "Backlog");
        var open = await client.CreateTicketAsync("WEB", "Open");
        var done = await client.CreateTicketAsync("WEB", "Done", extra: new { status = "Done" });
        await client.MoveOkAsync(board.Id.ToString(), [done.Key, open.Key]);
        var stranger = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var forbidden = await stranger.DeleteAsync($"/api/v1/boards/{board.Id}", _ct);
        var deleted = await client.DeleteAsync($"/api/v1/boards/{board.Id}", _ct);
        var backlog = await (await client.GetAsync("/api/v1/projects/WEB/backlog?showDone=true", _ct)).ReadAsync<BacklogDto>();
        var list = await (await client.GetAsync("/api/v1/boards?includeArchived=true", _ct)).ReadAsync<CursorPage<BoardSummaryDto>>();

        // Assert
        await forbidden.ShouldBeProblemAsync(HttpStatusCode.Forbidden, BoardErrors.NotOwner);
        await deleted.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        Assert.Equal(["WEB-3", "WEB-2", "WEB-1"], backlog.Items.Select(i => i.Key));
        Assert.Empty(list.Items);
    }

    [Fact]
    public async Task Read_only_tokens_can_read_boards_but_not_manage_them()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        await client.CreateProjectAsync("WEB");
        var board = await client.CreateBoardAsync("Sprint", "WEB");
        var readOnly = await api.CreatePatClientAsync(owner, Domain.Tokens.PatScope.ReadOnly);

        // Act
        var read = await readOnly.GetAsync($"/api/v1/boards/{board.Id}", _ct);
        var write = await readOnly.PatchAsJsonAsync($"/api/v1/boards/{board.Id}", new { name = "x" }, _ct);

        // Assert
        var fetched = await read.ReadAsync<BoardDto>();
        Assert.False(fetched.Permissions.CanManage);
        Assert.All(fetched.Projects, p => Assert.False(p.CanWrite));
        await write.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
    }
}
