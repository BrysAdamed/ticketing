using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Users;

[Collection(nameof(UsersCollection))]
public sealed class AdminUserTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Admin_creates_a_user_with_a_72_hour_link_and_no_password()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));

        // Act
        var created = await admin.CreateUserViaAdminAsync("New.Person@Ticketing.Test", "  New Person  ", GlobalRole.User);

        // Assert
        Assert.Equal("new.person@ticketing.test", created.User.Email);
        Assert.Equal("New Person", created.User.DisplayName);
        Assert.False(created.User.HasPassword);
        Assert.True(created.User.IsActive);
        Assert.StartsWith("/set-password?token=", created.SetPasswordLink.Path, StringComparison.Ordinal);
        Assert.InRange(created.SetPasswordLink.ExpiresAt - DateTimeOffset.UtcNow, TimeSpan.FromHours(71.9), TimeSpan.FromHours(72));
        Assert.Equal(created.SetPasswordLink.ExpiresAt, created.User.SetPasswordLinkExpiresAt!.Value, TimeSpan.FromMilliseconds(1));
        var stored = await api.WithDbAsync(db => db.Users.SingleAsync(u => u.Id == created.User.Id, _ct));
        Assert.Null(stored.PasswordHash);
        Assert.NotEqual(created.SetPasswordLink.Token, stored.SetPasswordTokenHash);
        Assert.Equal(1, await api.ActivityCountAsync("user.created"));
    }

    [Fact]
    public async Task Creating_a_user_with_a_taken_email_is_409()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var existing = await api.CreateUserAsync();

        // Act
        var response = await admin.PostAsJsonAsync("/api/v1/admin/users", new { email = existing.Email.ToUpperInvariant(), displayName = "Dup" }, _ct);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, UserErrors.EmailTaken);
        Assert.True(problem.GetProperty("errors").TryGetProperty("email", out _));
    }

    [Fact]
    public async Task Creating_a_user_validates_input()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));

        // Act
        var missing = await admin.PostAsJsonAsync("/api/v1/admin/users", new { email = "", displayName = "" }, _ct);
        var invalid = await admin.PostAsJsonAsync("/api/v1/admin/users", new { email = "not-an-email", displayName = "X" }, _ct);

        // Assert
        var problem = await missing.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.True(problem.GetProperty("errors").TryGetProperty("displayName", out _));
        await invalid.ShouldBeProblemAsync(HttpStatusCode.BadRequest, UserErrors.EmailInvalid);
    }

    [Fact]
    public async Task User_administration_is_admin_only_and_web_only()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var user = await api.LoginAsync(await api.CreateUserAsync());
        var adminPat = await api.CreatePatClientAsync(admin);

        // Act
        var asUser = await user.GetAsync("/api/v1/admin/users", _ct);
        var userCreate = await user.PostAsJsonAsync("/api/v1/admin/users", new { email = "x@ticketing.test", displayName = "X" }, _ct);
        var asPat = await adminPat.GetAsync("/api/v1/admin/users", _ct);
        var anonymous = await api.CreateBrowserClient().GetAsync("/api/v1/admin/users", _ct);

        // Assert
        await asUser.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "forbidden");
        await userCreate.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "forbidden");
        await asPat.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
        await anonymous.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task List_searches_filters_and_pages_by_display_name()
    {
        // Arrange
        var adminUser = await api.CreateUserAsync(GlobalRole.Admin, displayName: "Zed Admin");
        var admin = await api.LoginAsync(adminUser);
        foreach (var name in new[] { "Alice Smith", "Bob Smith", "Carol Smith", "Dan Jones" })
            await api.CreateUserAsync(displayName: name);
        var deactivated = await admin.CreateUserViaAdminAsync(displayName: "Eve Smith");
        await (await admin.PostAsync($"/api/v1/admin/users/{deactivated.User.Id}/deactivate", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var first = await (await admin.GetAsync("/api/v1/admin/users?query=smith&isActive=true&limit=2", _ct)).ReadAsync<CursorPage<AdminUserDto>>();
        var second = await (await admin.GetAsync($"/api/v1/admin/users?query=smith&isActive=true&limit=2&cursor={first.NextCursor}", _ct)).ReadAsync<CursorPage<AdminUserDto>>();
        var admins = await (await admin.GetAsync("/api/v1/admin/users?role=Admin", _ct)).ReadAsync<CursorPage<AdminUserDto>>();
        var inactive = await (await admin.GetAsync("/api/v1/admin/users?isActive=false", _ct)).ReadAsync<CursorPage<AdminUserDto>>();

        // Assert
        Assert.Equal(["Alice Smith", "Bob Smith"], first.Items.Select(u => u.DisplayName));
        Assert.Equal(["Carol Smith"], second.Items.Select(u => u.DisplayName));
        Assert.Null(second.NextCursor);
        Assert.Equal([adminUser.Id], admins.Items.Select(u => u.Id));
        Assert.Equal(["Eve Smith"], inactive.Items.Select(u => u.DisplayName));
    }

    [Fact]
    public async Task Admin_edits_display_name_and_role_with_history_and_if_match()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var target = await api.CreateUserAsync(displayName: "Old Name");
        var current = await (await admin.GetAsync($"/api/v1/admin/users/{target.Id}", _ct)).ReadAsync<AdminUserDto>();

        // Act
        var updated = await admin.SendAsync(Patch($"/api/v1/admin/users/{target.Id}", new { displayName = "New Name", globalRole = "Admin" }, current.RowVersion), _ct);
        var stale = await admin.SendAsync(Patch($"/api/v1/admin/users/{target.Id}", new { displayName = "Stale" }, current.RowVersion), _ct);

        // Assert
        var body = await updated.ReadAsync<AdminUserDto>();
        Assert.Equal(("New Name", GlobalRole.Admin), (body.DisplayName, body.GlobalRole));
        await stale.ShouldBeProblemAsync(HttpStatusCode.Conflict, "concurrency.conflict");
        var fields = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.Action == "user.field.changed").Select(a => a.Field).ToListAsync(_ct));
        Assert.Equal(["displayName", "globalRole"], fields.Order());
    }

    [Fact]
    public async Task The_last_active_admin_cannot_be_demoted_and_nobody_changes_their_own_role()
    {
        // Arrange
        var adminUser = await api.CreateUserAsync(GlobalRole.Admin);
        var admin = await api.LoginAsync(adminUser);
        var other = await api.CreateUserAsync(GlobalRole.Admin);
        await (await admin.PostAsync($"/api/v1/admin/users/{other.Id}/deactivate", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var self = await admin.PatchAsJsonAsync($"/api/v1/admin/users/{adminUser.Id}", new { globalRole = "User" }, _ct);
        var demoteInactive = await admin.PatchAsJsonAsync($"/api/v1/admin/users/{other.Id}", new { globalRole = "User" }, _ct);

        // Assert
        await self.ShouldBeProblemAsync(HttpStatusCode.Conflict, UserErrors.LastAdmin);
        await demoteInactive.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task An_admin_cannot_change_their_own_role_while_other_admins_exist()
    {
        // Arrange
        var adminUser = await api.CreateUserAsync(GlobalRole.Admin);
        await api.CreateUserAsync(GlobalRole.Admin);
        var admin = await api.LoginAsync(adminUser);

        // Act
        var response = await admin.PatchAsJsonAsync($"/api/v1/admin/users/{adminUser.Id}", new { globalRole = "User" }, _ct);
        var deactivateSelf = await admin.PostAsync($"/api/v1/admin/users/{adminUser.Id}/deactivate", null, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, UserErrors.SelfRoleChange);
        await deactivateSelf.ShouldBeProblemAsync(HttpStatusCode.Conflict, UserErrors.SelfDeactivation);
    }

    [Fact]
    public async Task Deactivation_blocks_login_ends_sessions_revokes_tokens_and_reactivation_restores_login_only()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var user = await api.CreateUserAsync();
        var session = await api.LoginAsync(user);
        var token = await api.CreatePatAsync(user);

        // Act
        var deactivated = await (await admin.PostAsync($"/api/v1/admin/users/{user.Id}/deactivate", null, _ct)).ReadAsync<AdminUserDto>();
        var sessionAfter = await session.GetAsync("/api/v1/me", _ct);
        var patAfter = await api.CreateBearerClient(token).GetAsync("/api/v1/me", _ct);
        var loginAfter = await api.TryLoginAsync(user.Email, user.Password);
        var reactivated = await (await admin.PostAsync($"/api/v1/admin/users/{user.Id}/reactivate", null, _ct)).ReadAsync<AdminUserDto>();
        var loginReactivated = await api.TryLoginAsync(user.Email, user.Password);
        var patReactivated = await api.CreateBearerClient(token).GetAsync("/api/v1/me", _ct);

        // Assert
        Assert.False(deactivated.IsActive);
        Assert.NotNull(deactivated.DeactivatedAt);
        Assert.Equal(0, deactivated.ActiveTokenCount);
        await sessionAfter.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
        await patAfter.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
        await loginAfter.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.invalidCredentials");
        Assert.True(reactivated.IsActive);
        await loginReactivated.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await patReactivated.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
        Assert.Equal(1, await api.ActivityCountAsync("pat.revoked"));
        Assert.Equal(1, await api.ActivityCountAsync("user.deactivated"));
        Assert.Equal(1, await api.ActivityCountAsync("user.reactivated"));
    }

    [Fact]
    public async Task Deactivating_the_last_owner_of_live_projects_fails_and_lists_them()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var owner = await api.CreateUserAsync();
        var coOwner = await api.CreateUserAsync();
        var inactiveOwner = await api.CreateUserAsync();
        await api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var solo = Project.Create("SOLO", "Solo", null, ProjectVisibility.Private, owner.Id, now);
            var alpha = Project.Create("ALPHA", "Alpha", null, ProjectVisibility.Public, owner.Id, now);
            alpha.AddMember(inactiveOwner.Id, ProjectRole.Owner, owner.Id, now);
            var shared = Project.Create("SHARED", "Shared", null, ProjectVisibility.Private, owner.Id, now);
            shared.AddMember(coOwner.Id, ProjectRole.Owner, owner.Id, now);
            var archived = Project.Create("OLD", "Old", null, ProjectVisibility.Private, owner.Id, now);
            archived.Archive(owner.Id, now);
            db.Projects.AddRange(solo, alpha, shared, archived);
            (await db.Users.SingleAsync(u => u.Id == inactiveOwner.Id, _ct)).Deactivate(owner.Id, now);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var response = await admin.PostAsync($"/api/v1/admin/users/{owner.Id}/deactivate", null, _ct);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, UserErrors.LastProjectOwner);
        Assert.Equal(["ALPHA", "SOLO"], problem.GetProperty("errors").GetProperty("projects").EnumerateArray().Select(e => e.GetString()));
        Assert.True(await api.WithDbAsync(db => db.Users.Where(u => u.Id == owner.Id).Select(u => u.IsActive).SingleAsync(_ct)));
    }

    [Fact]
    public async Task A_new_set_password_link_replaces_the_old_one_and_the_old_password_works_until_it_is_used()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var created = await admin.CreateUserViaAdminAsync();
        await (await api.SetPasswordAsync(created.SetPasswordLink.Token, IdentityTestApi.NewPassword)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

        // Act
        var first = await (await admin.PostAsync($"/api/v1/admin/users/{created.User.Id}/set-password-link", null, _ct)).ReadAsync<SetPasswordLinkDto>();
        var second = await (await admin.PostAsync($"/api/v1/admin/users/{created.User.Id}/set-password-link", null, _ct)).ReadAsync<SetPasswordLinkDto>();
        var oldPasswordStillWorks = await api.TryLoginAsync(created.User.Email, IdentityTestApi.NewPassword);
        var firstLink = await api.SetPasswordAsync(first.Token, "Another-Long-Passphrase-7");
        var secondLink = await api.SetPasswordAsync(second.Token, "Another-Long-Passphrase-7");
        var oldPasswordAfter = await api.TryLoginAsync(created.User.Email, IdentityTestApi.NewPassword);

        // Assert
        Assert.InRange(second.ExpiresAt - DateTimeOffset.UtcNow, TimeSpan.FromHours(23.9), TimeSpan.FromHours(24));
        await oldPasswordStillWorks.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await firstLink.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.SetPasswordTokenInvalid);
        await secondLink.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await oldPasswordAfter.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.invalidCredentials");
    }

    [Fact]
    public async Task Unknown_user_is_404()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));

        // Act
        var response = await admin.PostAsync($"/api/v1/admin/users/{Guid.NewGuid()}/deactivate", null, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.NotFound);
    }

    [Fact]
    public async Task Active_token_count_is_shown()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var user = await api.CreateUserAsync();
        await api.CreatePatAsync(user, PatScope.ReadOnly);
        await api.CreatePatAsync(user);

        // Act
        var dto = await (await admin.GetAsync($"/api/v1/admin/users/{user.Id}", _ct)).ReadAsync<AdminUserDto>();

        // Assert
        Assert.Equal(2, dto.ActiveTokenCount);
        Assert.True(dto.HasPassword);
    }

    private static HttpRequestMessage Patch(string url, object body, uint rowVersion)
    {
        var request = new HttpRequestMessage(HttpMethod.Patch, url) { Content = JsonContent.Create(body) };
        request.Headers.IfMatch.ParseAdd($"\"{rowVersion}\"");
        return request;
    }
}
