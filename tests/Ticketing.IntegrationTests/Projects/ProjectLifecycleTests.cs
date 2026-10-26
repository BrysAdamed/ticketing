using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Application.Projects;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Projects;

/// <summary>Archive, unarchive and delete (spec 4.3, 5.3).</summary>
[Collection(nameof(ProjectsCollection))]
public sealed class ProjectLifecycleTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Archive_returns_board_tickets_to_the_backlog_top_in_order_and_unlinks_every_board()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var projectId = await api.ProjectAsync(owner, "WEB");
        var otherProjectId = await api.ProjectAsync(owner, "API");
        var firstBoard = await api.BoardAsync(owner, "Sprint 1", projectId, otherProjectId);
        var secondBoard = await api.BoardAsync(owner, "Sprint 2", projectId);
        await api.TicketsAsync(projectId, owner,
            ("Backlog A", null, TicketStatus.ToDo),
            ("Backlog B", null, TicketStatus.ToDo),
            ("Board1 first", firstBoard, TicketStatus.InProgress),
            ("Board1 second", firstBoard, TicketStatus.Done),
            ("Board2 only", secondBoard, TicketStatus.ToDo));
        await api.TicketsAsync(otherProjectId, owner, ("Other project card", firstBoard, TicketStatus.ToDo));
        var client = await api.LoginAsync(owner);

        // Act
        var response = await client.PostAsync("/api/v1/projects/WEB/archive", null, _ct);

        // Assert
        var project = await response.ReadAsync<ProjectDto>();
        Assert.NotNull(project.ArchivedAt);
        Assert.Empty(project.Boards);
        var backlog = await api.WithDbAsync(db => db.Tickets.Where(t => t.ProjectId == projectId).ToListAsync(_ct));
        Assert.All(backlog, t => Assert.Null(t.BoardId));
        Assert.Equal(
            ["Board1 first", "Board1 second", "Board2 only", "Backlog A", "Backlog B"],
            backlog.OrderBy(t => t.Rank, StringComparer.Ordinal).Select(t => t.Title));
        var links = await api.WithDbAsync(db => db.BoardProjects.Select(bp => new { bp.BoardId, bp.ProjectId }).ToListAsync(_ct));
        Assert.Equal([new { BoardId = firstBoard, ProjectId = otherProjectId }], links);
        Assert.Equal(firstBoard, await api.WithDbAsync(db => db.Tickets.Where(t => t.ProjectId == otherProjectId).Select(t => t.BoardId).SingleAsync(_ct)));
        var actions = await api.WithDbAsync(db => db.ActivityEntries.Select(a => a.Action).ToListAsync(_ct));
        Assert.Equal(3, actions.Count(a => a == "ticket.moved"));
        Assert.Equal(2, actions.Count(a => a == "board.project.unlinked"));
        Assert.Contains("project.archived", actions);
    }

    [Fact]
    public async Task Archived_project_is_read_only_until_unarchived()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "WEB");
        var client = await api.LoginAsync(owner);
        await (await client.PostAsync("/api/v1/projects/WEB/archive", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var patch = await client.PatchAsJsonAsync("/api/v1/projects/WEB", new { name = "Renamed" }, _ct);
        var archiveAgain = await client.PostAsync("/api/v1/projects/WEB/archive", null, _ct);
        var defaultList = await (await client.GetAsync("/api/v1/projects", _ct)).ReadAsync<CursorPage<ProjectSummaryDto>>();
        var withArchived = await (await client.GetAsync("/api/v1/projects?includeArchived=true", _ct)).ReadAsync<CursorPage<ProjectSummaryDto>>();
        var unarchived = await (await client.PostAsync("/api/v1/projects/WEB/unarchive", null, _ct)).ReadAsync<ProjectDto>();
        var unarchiveAgain = await client.PostAsync("/api/v1/projects/WEB/unarchive", null, _ct);
        var patchAfter = await client.PatchAsJsonAsync("/api/v1/projects/WEB", new { name = "Renamed" }, _ct);

        // Assert
        await patch.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
        await archiveAgain.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
        Assert.Empty(defaultList.Items);
        Assert.NotNull(Assert.Single(withArchived.Items).ArchivedAt);
        Assert.Null(unarchived.ArchivedAt);
        await unarchiveAgain.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.NotArchived);
        await patchAfter.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Only_owners_archive_and_unarchive()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "PRIV", ProjectVisibility.Private, (member, ProjectRole.Member));
        await api.ProjectAsync(owner, "PUB", ProjectVisibility.Public);

        // Act
        var asMember = await (await api.LoginAsync(member)).PostAsync("/api/v1/projects/PRIV/archive", null, _ct);
        var outsiderClient = await api.LoginAsync(outsider);
        var asOutsiderPrivate = await outsiderClient.PostAsync("/api/v1/projects/PRIV/archive", null, _ct);
        var asOutsiderPublic = await outsiderClient.PostAsync("/api/v1/projects/PUB/archive", null, _ct);
        var ownerClient = await api.LoginAsync(owner);
        await (await ownerClient.PostAsync("/api/v1/projects/PRIV/archive", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var memberUnarchive = await (await api.LoginAsync(member)).PostAsync("/api/v1/projects/PRIV/unarchive", null, _ct);

        // Assert
        await asMember.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await asOutsiderPrivate.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        await asOutsiderPublic.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await memberUnarchive.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
    }

    [Fact]
    public async Task Admin_unarchiving_a_project_without_active_owners_becomes_its_owner()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.ProjectAsync(owner, "WEB");
        await (await (await api.LoginAsync(owner)).PostAsync("/api/v1/projects/WEB/archive", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await api.DeactivateAsync(owner);

        // Act
        var project = await (await (await api.LoginAsync(admin)).PostAsync("/api/v1/projects/WEB/unarchive", null, _ct)).ReadAsync<ProjectDto>();

        // Assert
        var adminMember = project.Members.Single(m => m.UserId == admin.Id);
        Assert.Equal(ProjectRole.Owner, adminMember.Role);
        Assert.Null(project.Members.Single(m => m.UserId == owner.Id).EffectiveRole);
    }

    [Fact]
    public async Task Admin_deletes_an_archived_project_after_typing_its_key()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var projectId = await api.ProjectAsync(owner, "WEB", ProjectVisibility.Public);
        await api.TicketsAsync(projectId, owner, ("Some work", null, TicketStatus.ToDo));
        var ownerClient = await api.LoginAsync(owner);

        // Act
        var notArchived = await admin.DeleteAsync("/api/v1/projects/WEB?confirmKey=WEB", _ct);
        await (await ownerClient.PostAsync("/api/v1/projects/WEB/archive", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var byOwner = await ownerClient.DeleteAsync("/api/v1/projects/WEB?confirmKey=WEB", _ct);
        var wrongKey = await admin.DeleteAsync("/api/v1/projects/WEB?confirmKey=web", _ct);
        var deleted = await admin.DeleteAsync("/api/v1/projects/WEB?confirmKey=WEB", _ct);
        var afterwards = await admin.GetAsync("/api/v1/projects/WEB", _ct);
        var listed = await (await admin.GetAsync("/api/v1/projects?includeArchived=true", _ct)).ReadAsync<CursorPage<ProjectSummaryDto>>();
        var reuseKey = await admin.PostAsJsonAsync("/api/v1/projects", new { key = "WEB", name = "New web" }, _ct);
        var reuseName = await admin.PostAsJsonAsync("/api/v1/projects", new { key = "WEB2", name = "WEB project" }, _ct);

        // Assert
        await notArchived.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.NotArchived);
        await byOwner.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.Forbidden);
        var problem = await wrongKey.ShouldBeProblemAsync(HttpStatusCode.BadRequest, ProjectErrors.DeleteNotConfirmed);
        Assert.True(problem.GetProperty("errors").TryGetProperty("confirmKey", out _));
        await deleted.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await afterwards.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        Assert.Empty(listed.Items);
        await reuseKey.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.KeyTaken);
        await reuseName.ShouldHaveStatusAsync(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Delete_is_refused_for_personal_access_tokens()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.ProjectAsync(admin, "WEB");
        await (await (await api.LoginAsync(admin)).PostAsync("/api/v1/projects/WEB/archive", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var pat = await api.CreatePatClientAsync(admin);

        // Act
        var response = await pat.DeleteAsync("/api/v1/projects/WEB?confirmKey=WEB", _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.CookieSessionRequired);
    }
}
