using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Tickets;

[Collection(nameof(TicketsCollection))]
public sealed class TicketEndpointTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Create_returns_201_with_a_key_defaults_and_a_created_activity()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("WEB");

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/projects/web/tickets", new { title = "  Fix login  ", type = "Bug" }, _ct);

        // Assert
        var ticket = await response.ReadAsync<TicketSummaryDto>(HttpStatusCode.Created);
        Assert.Equal("/api/v1/tickets/WEB-1", response.Headers.Location?.OriginalString);
        Assert.Equal(("WEB-1", "Fix login", TicketStatus.ToDo, Priority.Medium), (ticket.Key, ticket.Title, ticket.Status, ticket.Priority));
        Assert.Equal(TicketLocationKind.Backlog, ticket.Location.Kind);
        var activity = await api.WithDbAsync(db => db.ActivityEntries.SingleAsync(a => a.Action == "ticket.created", _ct));
        Assert.Equal((ticket.Id, user.Id, WriteChannel.Web), (activity.EntityId, activity.ActorId, activity.Channel));
    }

    [Fact]
    public async Task Create_reports_every_invalid_field()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/projects/WEB/tickets", new { title = "", storyPoints = 500 }, _ct);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        var errors = problem.GetProperty("errors");
        Assert.True(errors.TryGetProperty("title", out _));
        Assert.True(errors.TryGetProperty("type", out _));
        Assert.True(errors.TryGetProperty("storyPoints", out _));
    }

    [Fact]
    public async Task Create_sets_all_fields_normalizes_labels_and_appends_to_the_bottom()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("WEB");
        var epic = await client.CreateTicketAsync("WEB", "Epic", "Epic");

        // Act
        var ticket = await client.CreateTicketAsync("WEB", "Story", "UserStory", new
        {
            description = "Some *markdown*",
            priority = "High",
            severity = "Major",
            storyPoints = 5,
            version = "1.4.0",
            labels = new[] { "Backend", "backend", " api " },
            parentKey = epic.Key,
            assignee = user.Email,
        });

        // Assert
        var full = await client.GetTicketAsync(ticket.Key);
        Assert.Equal(["api", "backend"], full.Labels);
        Assert.Equal((Priority.High, Severity.Major, 5, "1.4.0"), (full.Priority, full.Severity!.Value, full.StoryPoints!.Value, full.Version));
        Assert.Equal(epic.Key, full.Parent?.Key);
        Assert.Equal(user.Id, full.Assignee?.Id);
        var ranks = await api.WithDbAsync(db => db.Tickets.OrderBy(t => t.Number).Select(t => t.Rank).ToListAsync(_ct));
        Assert.True(string.CompareOrdinal(ranks[0], ranks[1]) < 0);
    }

    [Fact]
    public async Task Create_with_the_same_idempotency_key_returns_the_original_ticket()
    {
        // Arrange
        var client = await api.CreatePatClientAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        HttpRequestMessage Request() => new(HttpMethod.Post, "/api/v1/projects/WEB/tickets")
        {
            Content = JsonContent.Create(new { title = "Once", type = "Bug" }),
            Headers = { { "Idempotency-Key", "ticket-1" } },
        };

        // Act
        var first = await (await client.SendAsync(Request(), _ct)).ReadAsync<TicketSummaryDto>(HttpStatusCode.Created);
        var replay = await (await client.SendAsync(Request(), _ct)).ReadAsync<TicketSummaryDto>(HttpStatusCode.Created);

        // Assert
        Assert.Equal(first.Id, replay.Id);
        Assert.Equal(1, await api.WithDbAsync(db => db.Tickets.CountAsync(_ct)));
    }

    [Fact]
    public async Task Assignee_must_be_an_active_user_who_can_write_to_the_project()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        var viewer = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewer, ProjectRole.Viewer);
        var outsider = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var ticket = await client.CreateTicketAsync("WEB", "Task");

        // Act
        var toViewer = await client.PatchAsJsonAsync($"/api/v1/tickets/{ticket.Key}", new { assignee = viewer.Email }, _ct);
        var toOutsider = await client.PatchAsJsonAsync($"/api/v1/tickets/{ticket.Key}", new { assignee = outsider.Id }, _ct);
        var toAdmin = await client.PatchAsJsonAsync($"/api/v1/tickets/{ticket.Key}", new { assignee = admin.Email }, _ct);

        // Assert
        await toViewer.ShouldBeProblemAsync(HttpStatusCode.BadRequest, TicketErrors.AssigneeInvalid);
        await toOutsider.ShouldBeProblemAsync(HttpStatusCode.BadRequest, TicketErrors.AssigneeInvalid);
        Assert.Equal(admin.Id, (await toAdmin.ReadAsync<TicketDto>()).Assignee?.Id);
    }

    [Fact]
    public async Task Permissions_follow_effective_project_access()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var privateProject = await ownerClient.CreateProjectAsync("PRIV");
        await ownerClient.CreateProjectAsync("OPEN", ProjectVisibility.Public);
        var privateTicket = await ownerClient.CreateTicketAsync("PRIV", "Secret");
        var viewerUser = await api.CreateUserAsync();
        await api.AddMemberAsync(privateProject.Id, viewerUser, ProjectRole.Viewer);
        var viewer = await api.LoginAsync(viewerUser);
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var viewerRead = await viewer.GetAsync($"/api/v1/tickets/{privateTicket.Key}", _ct);
        var viewerCreate = await viewer.PostAsJsonAsync("/api/v1/projects/PRIV/tickets", new { title = "x", type = "Bug" }, _ct);
        var viewerPatch = await viewer.PatchAsJsonAsync($"/api/v1/tickets/{privateTicket.Key}", new { title = "x" }, _ct);
        var outsiderRead = await outsider.GetAsync($"/api/v1/tickets/{privateTicket.Key}", _ct);
        var outsiderById = await outsider.GetAsync($"/api/v1/tickets/{privateTicket.Id}", _ct);
        var outsiderCreatePublic = await outsider.PostAsJsonAsync("/api/v1/projects/OPEN/tickets", new { title = "Open work", type = "Bug" }, _ct);

        // Assert
        var read = await viewerRead.ReadAsync<TicketDto>();
        Assert.False(read.Permissions.CanEdit);
        await viewerCreate.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await viewerPatch.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await outsiderRead.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
        await outsiderById.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
        await outsiderCreatePublic.ShouldHaveStatusAsync(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Read_only_token_cannot_write_tickets()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Task");
        var readOnly = await api.CreatePatClientAsync(owner, Domain.Tokens.PatScope.ReadOnly);

        // Act
        var get = await readOnly.GetAsync($"/api/v1/tickets/{ticket.Key}", _ct);
        var patch = await readOnly.PatchAsJsonAsync($"/api/v1/tickets/{ticket.Key}", new { title = "x" }, _ct);

        // Assert
        await get.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await patch.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
    }

    [Fact]
    public async Task Get_returns_children_with_progress_links_comments_and_test_cases()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        var epic = await client.CreateTicketAsync("WEB", "Epic", "Epic");
        await client.CreateTicketAsync("WEB", "Child 1", extra: new { parentKey = epic.Key });
        await client.CreateTicketAsync("WEB", "Child 2", extra: new { parentKey = epic.Key, status = "Done" });
        await client.CreateTicketAsync("WEB", "Child 3", extra: new { parentKey = epic.Key, status = "Review" });
        var other = await client.CreateTicketAsync("WEB", "Blocker");
        await (await client.PostAsJsonAsync($"/api/v1/tickets/{other.Key}/links", new { targetKey = epic.Key, type = "Blocks" }, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);
        await (await client.PostAsJsonAsync($"/api/v1/tickets/{epic.Key}/comments", new { body = "First" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);
        await api.WithDbAsync(async db =>
        {
            var testCase = TestCase.Create(project.Id, 1, "Login works", owner.Id, DateTimeOffset.UtcNow);
            testCase.LinkTicket(epic.Id);
            db.TestCases.Add(testCase);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var response = await client.GetAsync("/api/v1/tickets/web-1", _ct);

        // Assert
        var ticket = await response.ReadAsync<TicketDto>();
        Assert.Equal($"\"{ticket.RowVersion}\"", response.Headers.ETag?.Tag);
        Assert.Equal(["WEB-2", "WEB-3", "WEB-4"], ticket.Children!.Select(c => c.Key));
        Assert.Equal(new ProgressDto(1, 1, 1, 3), ticket.ChildProgress);
        var link = Assert.Single(ticket.Links!);
        Assert.Equal(("is blocked by", LinkDirection.Inward, other.Key), (link.Label, link.Direction, link.Ticket.Key));
        Assert.Equal("First", Assert.Single(ticket.Comments!).Body);
        Assert.Equal(1, ticket.CommentCount);
        Assert.Equal("WEB-TC-1", Assert.Single(ticket.TestCases!).Key);
        Assert.True(ticket.Permissions.CanDelete);
    }

    [Fact]
    public async Task Patch_changes_only_supplied_fields_and_writes_one_entry_per_field_with_one_timestamp()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Old title", extra: new { description = "Keep me", version = "1.0" });

        // Act
        var updated = await client.PatchTicketAsync(ticket.Key, new { title = "New title", priority = "Highest", version = (string?)null, addLabels = new[] { "ui" } });

        // Assert
        Assert.Equal(("New title", "Keep me", Priority.Highest, (string?)null), (updated.Title, updated.Description, updated.Priority, updated.Version));
        Assert.Equal(["ui"], updated.Labels);
        var entries = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.Action == UpdateTicket.FieldChanged).ToListAsync(_ct));
        Assert.Equal(["labels", "priority", "title", "version"], entries.Select(e => e.Field).Order());
        Assert.Single(entries.Select(e => e.OccurredAt).Distinct());
    }

    [Fact]
    public async Task Status_side_effects_follow_spec_6_2()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Task");

        // Act
        var done = await client.PatchTicketAsync(ticket.Key, new { status = "Done" });
        var wontDo = await client.PatchTicketAsync(ticket.Key, new { resolution = "WontDo" });
        var reopened = await client.PatchTicketAsync(ticket.Key, new { status = "InProgress" });
        var invalid = await client.PatchAsJsonAsync($"/api/v1/tickets/{ticket.Key}", new { resolution = "Duplicate" }, _ct);

        // Assert
        Assert.Equal((Resolution.Done, true), (done.Resolution!.Value, done.ResolvedAt is not null));
        Assert.Equal(Resolution.WontDo, wontDo.Resolution);
        Assert.Equal(((Resolution?)null, (DateTimeOffset?)null), (reopened.Resolution, reopened.ResolvedAt));
        await invalid.ShouldBeProblemAsync(HttpStatusCode.BadRequest, TicketErrors.ResolutionWithoutDone);
    }

    [Fact]
    public async Task Leaving_done_on_an_archived_board_moves_the_ticket_to_the_backlog_top()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        await client.CreateTicketAsync("WEB", "Backlog item");
        var ticket = await client.CreateTicketAsync("WEB", "Shipped", extra: new { status = "Done" });
        var boardId = await api.CreateBoardAsync(owner.Id, project.Id);
        await api.PlaceOnBoardAsync(ticket.Id, boardId);
        await api.WithDbAsync(async db =>
        {
            var board = await db.Boards.SingleAsync(b => b.Id == boardId, _ct);
            board.Archive(owner.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var reopened = await client.PatchTicketAsync(ticket.Key, new { status = "ToDo" });

        // Assert
        Assert.Equal(TicketLocationKind.Backlog, reopened.Location.Kind);
        var backlog = await api.WithDbAsync(db => db.Tickets.Where(t => t.BoardId == null).OrderBy(t => t.Rank).Select(t => t.Id).ToListAsync(_ct));
        Assert.Equal(ticket.Id, backlog[0]);
        Assert.True(await api.WithDbAsync(db => db.ActivityEntries.AnyAsync(a => a.Action == "ticket.moved" && a.EntityId == ticket.Id, _ct)));
    }

    [Fact]
    public async Task Patch_with_a_stale_if_match_returns_409()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Task");
        await client.PatchTicketAsync(ticket.Key, new { description = "First" });
        var stale = new HttpRequestMessage(HttpMethod.Patch, $"/api/v1/tickets/{ticket.Key}")
        {
            Content = JsonContent.Create(new { description = "Second" }),
            Headers = { { "If-Match", $"\"{ticket.RowVersion}\"" } },
        };

        // Act
        var response = await client.SendAsync(stale, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, AppErrors.ConcurrencyConflict);
    }

    [Fact]
    public async Task Parent_rules_reject_epic_parents_depth_cycles_and_other_projects()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        await client.CreateProjectAsync("OTHER");
        var epic = await client.CreateTicketAsync("WEB", "Epic", "Epic");
        var story = await client.CreateTicketAsync("WEB", "Story", extra: new { parentKey = epic.Key });
        var task = await client.CreateTicketAsync("WEB", "Task", "Technical", new { parentKey = story.Key });
        var loose = await client.CreateTicketAsync("WEB", "Loose");
        var foreign = await client.CreateTicketAsync("OTHER", "Foreign");

        // Act
        var epicWithParent = await client.PatchAsJsonAsync($"/api/v1/tickets/{epic.Key}", new { parentKey = loose.Key }, _ct);
        var tooDeep = await client.PatchAsJsonAsync($"/api/v1/tickets/{loose.Key}", new { parentKey = task.Key }, _ct);
        var cycle = await client.PatchAsJsonAsync($"/api/v1/tickets/{story.Key}", new { parentKey = task.Key }, _ct);
        var otherProject = await client.PatchAsJsonAsync($"/api/v1/tickets/{foreign.Key}", new { parentKey = epic.Key }, _ct);
        var becomeEpic = await client.PatchAsJsonAsync($"/api/v1/tickets/{story.Key}", new { type = "Epic" }, _ct);
        var clearAndBecomeEpic = await client.PatchAsJsonAsync($"/api/v1/tickets/{story.Key}", new { type = "Epic", parentKey = (string?)null }, _ct);

        // Assert
        await epicWithParent.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.EpicCannotHaveParent);
        await tooDeep.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.ParentDepth);
        await cycle.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.ParentCycle);
        await otherProject.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.ParentOtherProject);
        await becomeEpic.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.EpicCannotHaveParent);
        var cleared = await clearAndBecomeEpic.ReadAsync<TicketDto>();
        Assert.Equal((TicketType.Epic, (TicketRefDto?)null), (cleared.Type, cleared.Parent));
    }

    [Fact]
    public async Task Delete_is_owner_only_blocked_by_children_and_cleans_up()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        var memberUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, memberUser, ProjectRole.Member);
        var member = await api.LoginAsync(memberUser);
        var parent = await client.CreateTicketAsync("WEB", "Parent");
        var child = await client.CreateTicketAsync("WEB", "Child", extra: new { parentKey = parent.Key });
        var related = await client.CreateTicketAsync("WEB", "Related");
        await (await client.PostAsJsonAsync($"/api/v1/tickets/{child.Key}/links", new { targetKey = related.Key, type = "RelatesTo" }, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);
        await api.WithDbAsync(async db =>
        {
            var testCase = TestCase.Create(project.Id, 1, "Case", owner.Id, DateTimeOffset.UtcNow);
            testCase.LinkTicket(child.Id);
            db.TestCases.Add(testCase);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var byMember = await member.DeleteAsync($"/api/v1/tickets/{child.Key}", _ct);
        var withChildren = await client.DeleteAsync($"/api/v1/tickets/{parent.Key}", _ct);
        var deleted = await client.DeleteAsync($"/api/v1/tickets/{child.Key}", _ct);
        var afterwards = await client.GetAsync($"/api/v1/tickets/{child.Key}", _ct);

        // Assert
        await byMember.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await withChildren.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.HasChildren);
        await deleted.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        var problem = await afterwards.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.Deleted);
        Assert.StartsWith($"{child.Key} was deleted by {owner.DisplayName}", problem.GetProperty("title").GetString(), StringComparison.Ordinal);
        Assert.Equal(0, await api.WithDbAsync(db => db.TicketLinks.CountAsync(_ct)));
        Assert.Null(await api.WithDbAsync(db => db.TestCases.Select(c => c.TicketId).SingleAsync(_ct)));
        Assert.Empty((await client.GetTicketAsync(related.Key)).Links!);
        await (await client.DeleteAsync($"/api/v1/tickets/{parent.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task Deleted_ticket_numbers_are_never_reused()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var first = await client.CreateTicketAsync("WEB", "First");
        await (await client.DeleteAsync($"/api/v1/tickets/{first.Key}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

        // Act
        var second = await client.CreateTicketAsync("WEB", "Second");

        // Assert
        Assert.Equal("WEB-2", second.Key);
    }
}
