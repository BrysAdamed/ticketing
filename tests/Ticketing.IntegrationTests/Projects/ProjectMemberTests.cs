using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Application.Projects;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Projects;

[Collection(nameof(ProjectsCollection))]
public sealed class ProjectMemberTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Owner_adds_a_member_by_email_and_it_is_listed_with_activity()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var newcomer = await api.CreateUserAsync(displayName: "Zed Newcomer");
        await api.ProjectAsync(owner, "WEB");
        var client = await api.LoginAsync(owner);

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/projects/WEB/members", new { user = newcomer.Email.ToUpperInvariant(), role = "Member" }, _ct);
        var members = await (await client.GetAsync("/api/v1/projects/web/members", _ct)).ReadAsync<List<ProjectMemberDto>>();

        // Assert
        var added = await response.ReadAsync<ProjectMemberDto>(HttpStatusCode.Created);
        Assert.Equal((newcomer.Id, ProjectRole.Member, ProjectRole.Member), (added.UserId, added.Role, added.EffectiveRole));
        Assert.Equal([owner.Id, newcomer.Id], members.Select(m => m.UserId));
        var actions = await api.WithDbAsync(db => db.ActivityEntries.Select(a => a.Action).ToListAsync(_ct));
        Assert.Contains("project.member.added", actions);
    }

    [Fact]
    public async Task Add_by_id_rejects_unknown_inactive_and_existing_users()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var inactive = await api.CreateUserAsync();
        await api.DeactivateAsync(inactive);
        await api.ProjectAsync(owner, "WEB");
        var client = await api.LoginAsync(owner);

        // Act
        var unknown = await client.PostAsJsonAsync("/api/v1/projects/WEB/members", new { user = Guid.NewGuid().ToString(), role = "Member" }, _ct);
        var deactivated = await client.PostAsJsonAsync("/api/v1/projects/WEB/members", new { user = inactive.Id.ToString(), role = "Member" }, _ct);
        var existing = await client.PostAsJsonAsync("/api/v1/projects/WEB/members", new { user = owner.Email, role = "Viewer" }, _ct);
        var invalid = await client.PostAsJsonAsync("/api/v1/projects/WEB/members", new { user = "" }, _ct);

        // Assert
        await unknown.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.NotFound);
        await deactivated.ShouldBeProblemAsync(HttpStatusCode.Conflict, UserErrors.Inactive);
        await existing.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.AlreadyMember);
        var problem = await invalid.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.Validation);
        Assert.True(problem.GetProperty("errors").TryGetProperty("user", out _));
        Assert.True(problem.GetProperty("errors").TryGetProperty("role", out _));
    }

    [Fact]
    public async Task Only_owners_and_admins_manage_members()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var candidate = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "PRIV", ProjectVisibility.Private, (member, ProjectRole.Member), (viewer, ProjectRole.Viewer));
        await api.ProjectAsync(owner, "PUB", ProjectVisibility.Public);
        object Body() => new { user = candidate.Email, role = "Member" };

        // Act
        var asMember = await (await api.LoginAsync(member)).PostAsJsonAsync("/api/v1/projects/PRIV/members", Body(), _ct);
        var asViewer = await (await api.LoginAsync(viewer)).PostAsJsonAsync("/api/v1/projects/PRIV/members", Body(), _ct);
        var outsiderClient = await api.LoginAsync(outsider);
        var asOutsiderPrivate = await outsiderClient.PostAsJsonAsync("/api/v1/projects/PRIV/members", Body(), _ct);
        var asOutsiderPrivateList = await outsiderClient.GetAsync("/api/v1/projects/PRIV/members", _ct);
        var asOutsiderPublic = await outsiderClient.PostAsJsonAsync("/api/v1/projects/PUB/members", Body(), _ct);
        var asAdmin = await (await api.LoginAsync(admin)).PostAsJsonAsync("/api/v1/projects/PRIV/members", Body(), _ct);

        // Assert
        await asMember.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await asViewer.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await asOutsiderPrivate.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        await asOutsiderPrivateList.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        await asOutsiderPublic.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await asAdmin.ShouldHaveStatusAsync(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Viewer_on_a_public_project_is_reported_with_member_effective_role()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.ProjectAsync(owner, "PUB", ProjectVisibility.Public, (viewer, ProjectRole.Viewer), (admin, ProjectRole.Viewer));
        var client = await api.LoginAsync(owner);

        // Act
        var publicMembers = await (await client.GetAsync("/api/v1/projects/PUB/members", _ct)).ReadAsync<List<ProjectMemberDto>>();
        await (await client.PatchAsJsonAsync("/api/v1/projects/PUB", new { visibility = "Private" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var privateMembers = await (await client.GetAsync("/api/v1/projects/PUB", _ct)).ReadAsync<ProjectDto>();

        // Assert
        Assert.Equal((ProjectRole.Viewer, ProjectRole.Member), Roles(publicMembers, viewer));
        Assert.Equal((ProjectRole.Viewer, ProjectRole.Owner), Roles(publicMembers, admin));
        Assert.Equal((ProjectRole.Viewer, ProjectRole.Viewer), Roles(privateMembers.Members, viewer));
    }

    [Fact]
    public async Task Change_role_keeps_an_active_owner()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var coOwner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "WEB", ProjectVisibility.Private, (coOwner, ProjectRole.Owner), (member, ProjectRole.Member));
        await api.DeactivateAsync(coOwner);
        var client = await api.LoginAsync(owner);

        // Act
        var demoteSelf = await client.PatchAsJsonAsync($"/api/v1/projects/WEB/members/{owner.Id}", new { role = "Member" }, _ct);
        var promote = await client.PatchAsJsonAsync($"/api/v1/projects/WEB/members/{member.Id}", new { role = "Owner" }, _ct);
        var notMember = await client.PatchAsJsonAsync($"/api/v1/projects/WEB/members/{Guid.NewGuid()}", new { role = "Viewer" }, _ct);
        var demoteAfterPromotion = await client.PatchAsJsonAsync($"/api/v1/projects/WEB/members/{owner.Id}", new { role = "Viewer" }, _ct);

        // Assert
        await demoteSelf.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.LastOwner);
        Assert.Equal(ProjectRole.Owner, (await promote.ReadAsync<ProjectMemberDto>()).Role);
        Assert.Equal(ProjectRole.Viewer, (await demoteAfterPromotion.ReadAsync<ProjectMemberDto>()).Role);
        await notMember.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotMember);
        var fields = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.Action == "project.member.roleChanged").CountAsync(_ct));
        Assert.Equal(2, fields);
    }

    [Fact]
    public async Task Remove_member_keeps_their_tickets_and_refuses_the_last_owner()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var projectId = await api.ProjectAsync(owner, "WEB", ProjectVisibility.Private, (member, ProjectRole.Member));
        await api.TicketsAsync(projectId, member, ("Mine", null, Domain.Tickets.TicketStatus.ToDo));
        var client = await api.LoginAsync(owner);

        // Act
        var removed = await client.DeleteAsync($"/api/v1/projects/WEB/members/{member.Id}", _ct);
        var again = await client.DeleteAsync($"/api/v1/projects/WEB/members/{member.Id}", _ct);
        var lastOwner = await client.DeleteAsync($"/api/v1/projects/WEB/members/{owner.Id}", _ct);

        // Assert
        await removed.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await again.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotMember);
        await lastOwner.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.LastOwner);
        Assert.Equal(1, await api.WithDbAsync(db => db.Tickets.CountAsync(t => t.ReporterId == member.Id, _ct)));
        await (await (await api.LoginAsync(member)).GetAsync("/api/v1/projects/WEB", _ct)).ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
    }

    [Fact]
    public async Task Concurrent_removal_of_two_owners_keeps_one()
    {
        // Arrange
        var first = await api.CreateUserAsync();
        var second = await api.CreateUserAsync();
        await api.ProjectAsync(first, "WEB", ProjectVisibility.Private, (second, ProjectRole.Owner));
        var firstClient = await api.LoginAsync(first);
        var secondClient = await api.LoginAsync(second);

        // Act
        var responses = await Task.WhenAll(
            firstClient.DeleteAsync($"/api/v1/projects/WEB/members/{second.Id}", _ct),
            secondClient.DeleteAsync($"/api/v1/projects/WEB/members/{first.Id}", _ct));

        // Assert
        Assert.Equal(1, responses.Count(r => r.StatusCode == HttpStatusCode.NoContent));
        var owners = await api.WithDbAsync(db => db.ProjectMembers.CountAsync(m => m.Role == ProjectRole.Owner, _ct));
        Assert.Equal(1, owners);
    }

    [Fact]
    public async Task Membership_changes_need_a_writable_token_and_a_non_archived_project()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var candidate = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "WEB");
        await api.ProjectAsync(owner, "OLD");
        var client = await api.LoginAsync(owner);
        await (await client.PostAsync("/api/v1/projects/OLD/archive", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var readOnly = await api.CreatePatClientAsync(owner, PatScope.ReadOnly);

        // Act
        var viaReadOnly = await readOnly.PostAsJsonAsync("/api/v1/projects/WEB/members", new { user = candidate.Email, role = "Member" }, _ct);
        var onArchived = await client.PostAsJsonAsync("/api/v1/projects/OLD/members", new { user = candidate.Email, role = "Member" }, _ct);

        // Assert
        await viaReadOnly.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
        await onArchived.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
    }

    [Fact]
    public async Task Projects_solely_owned_by_a_user_ignore_archived_projects_and_inactive_co_owners()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var activeCoOwner = await api.CreateUserAsync();
        var inactiveCoOwner = await api.CreateUserAsync();
        await api.ProjectAsync(user, "SOLO");
        await api.ProjectAsync(user, "SHARED", ProjectVisibility.Private, (activeCoOwner, ProjectRole.Owner));
        await api.ProjectAsync(user, "GHOST", ProjectVisibility.Private, (inactiveCoOwner, ProjectRole.Owner));
        await api.ProjectAsync(activeCoOwner, "OTHER", ProjectVisibility.Private, (user, ProjectRole.Member));
        await api.ProjectAsync(user, "OLD");
        await api.DeactivateAsync(inactiveCoOwner);
        await (await (await api.LoginAsync(user)).PostAsync("/api/v1/projects/OLD/archive", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var keys = await api.WithDbAsync(db => ProjectOwnership.ProjectsSolelyOwnedByAsync(db, user.Id, _ct));

        // Assert
        Assert.Equal(["GHOST", "SOLO"], keys);
    }

    private static (ProjectRole Role, ProjectRole? Effective) Roles(IEnumerable<ProjectMemberDto> members, TestUser user)
    {
        var member = members.Single(m => m.UserId == user.Id);
        return (member.Role, member.EffectiveRole);
    }
}
