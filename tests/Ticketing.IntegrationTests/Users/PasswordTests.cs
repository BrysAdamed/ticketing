using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Auth;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Users;

[Collection(nameof(UsersCollection))]
public sealed class PasswordTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Onboarding_link_is_inspected_used_once_and_then_the_user_signs_in()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var created = await admin.CreateUserViaAdminAsync(displayName: "Onboarded");
        var anonymous = api.CreateBrowserClient();

        // Act
        var info = await (await anonymous.PostAsJsonAsync("/api/v1/auth/set-password/inspect", new { token = created.SetPasswordLink.Token }, _ct))
            .ReadAsync<SetPassword.LinkInfo>();
        var set = await api.SetPasswordAsync(created.SetPasswordLink.Token, IdentityTestApi.NewPassword);
        var reuse = await api.SetPasswordAsync(created.SetPasswordLink.Token, "Yet-Another-Passphrase-1");
        var inspectAfter = await anonymous.PostAsJsonAsync("/api/v1/auth/set-password/inspect", new { token = created.SetPasswordLink.Token }, _ct);
        var login = await api.TryLoginAsync(created.User.Email, IdentityTestApi.NewPassword);

        // Assert
        Assert.Equal((created.User.Email, "Onboarded", true), (info.Email, info.DisplayName, info.IsNewUser));
        await set.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await reuse.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.SetPasswordTokenInvalid);
        await inspectAfter.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.SetPasswordTokenInvalid);
        await login.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(1, await api.ActivityCountAsync("user.password.set"));
    }

    [Fact]
    public async Task Expired_unknown_and_deactivated_links_are_the_same_404()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var expired = await admin.CreateUserViaAdminAsync();
        var deactivated = await admin.CreateUserViaAdminAsync();
        await api.WithDbAsync(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == expired.User.Id, _ct);
            user.IssueSetPasswordToken(user.SetPasswordTokenHash!, DateTimeOffset.UtcNow.AddMinutes(-1));
            return await db.SaveChangesAsync(_ct);
        });
        await (await admin.PostAsync($"/api/v1/admin/users/{deactivated.User.Id}/deactivate", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var expiredResponse = await api.SetPasswordAsync(expired.SetPasswordLink.Token, IdentityTestApi.NewPassword);
        var unknownResponse = await api.SetPasswordAsync("not-a-real-token", IdentityTestApi.NewPassword);
        var deactivatedResponse = await api.SetPasswordAsync(deactivated.SetPasswordLink.Token, IdentityTestApi.NewPassword);

        // Assert
        await expiredResponse.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.SetPasswordTokenInvalid);
        await unknownResponse.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.SetPasswordTokenInvalid);
        await deactivatedResponse.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.SetPasswordTokenInvalid);
    }

    [Theory]
    [InlineData("short-pass", UserErrors.PasswordTooShort)]
    [InlineData("qwerty123456", UserErrors.PasswordTooCommon)]
    [InlineData("QWERTYQWERTY", UserErrors.PasswordTooCommon)]
    [InlineData("EMAIL", UserErrors.PasswordEqualsEmail)]
    [InlineData("LONG", UserErrors.PasswordTooLong)]
    public async Task Password_policy_is_enforced_on_set_password(string password, string code)
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var created = await admin.CreateUserViaAdminAsync(email: "policy.check@ticketing.test");
        password = password switch
        {
            "EMAIL" => "Policy.Check@ticketing.test",
            "LONG" => new string('x', 129),
            _ => password,
        };

        // Act
        var response = await api.SetPasswordAsync(created.SetPasswordLink.Token, password);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, code);
        Assert.True(problem.GetProperty("errors").TryGetProperty("password", out _));
    }

    [Fact]
    public async Task Resetting_through_a_link_ends_existing_sessions_and_lifts_a_lockout()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var user = await api.CreateUserAsync();
        var session = await api.LoginAsync(user);
        for (var i = 0; i < User.MaxFailedLogins; i++)
            await api.TryLoginAsync(user.Email, "wrong-password-123");
        var link = await (await admin.PostAsync($"/api/v1/admin/users/{user.Id}/set-password-link", null, _ct)).ReadAsync<Application.Users.SetPasswordLinkDto>();

        // Act
        await (await api.SetPasswordAsync(link.Token, IdentityTestApi.NewPassword)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        var oldSession = await session.GetAsync("/api/v1/me", _ct);
        var login = await api.TryLoginAsync(user.Email, IdentityTestApi.NewPassword);

        // Assert
        await oldSession.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
        await login.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(1, await api.ActivityCountAsync("user.password.reset"));
    }

    [Fact]
    public async Task Changing_the_password_needs_the_current_one_ends_other_sessions_and_keeps_this_one()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var current = await api.LoginAsync(user);
        var other = await api.LoginAsync(user);

        // Act
        var wrong = await current.PostAsJsonAsync("/api/v1/me/password", new { currentPassword = "wrong-password-123", newPassword = IdentityTestApi.NewPassword }, _ct);
        var weak = await current.PostAsJsonAsync("/api/v1/me/password", new { currentPassword = user.Password, newPassword = "1qaz2wsx3edc" }, _ct);
        var changed = await current.PostAsJsonAsync("/api/v1/me/password", new { currentPassword = user.Password, newPassword = IdentityTestApi.NewPassword }, _ct);
        var currentAfter = await current.GetAsync("/api/v1/me", _ct);
        var currentWriteAfter = await current.PatchAsJsonAsync("/api/v1/me", new { displayName = "Still Here" }, _ct);
        var otherAfter = await other.GetAsync("/api/v1/me", _ct);
        var oldLogin = await api.TryLoginAsync(user.Email, user.Password);
        var newLogin = await api.TryLoginAsync(user.Email, IdentityTestApi.NewPassword);

        // Assert
        await wrong.ShouldBeProblemAsync(HttpStatusCode.BadRequest, UserErrors.CurrentPasswordInvalid);
        var weakProblem = await weak.ShouldBeProblemAsync(HttpStatusCode.BadRequest, UserErrors.PasswordTooCommon);
        Assert.True(weakProblem.GetProperty("errors").TryGetProperty("newPassword", out _));
        await changed.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await currentAfter.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await currentWriteAfter.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await otherAfter.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
        await oldLogin.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.invalidCredentials");
        await newLogin.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Users_change_their_own_display_name_but_not_with_a_token()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var session = await api.LoginAsync(user);
        var pat = await api.CreatePatClientAsync(user);

        // Act
        var renamed = await (await session.PatchAsJsonAsync("/api/v1/me", new { displayName = "  Renamed  " }, _ct)).ReadAsync<CurrentUserDto>();
        var me = await (await session.GetAsync("/api/v1/me", _ct)).ReadAsync<CurrentUserDto>();
        var viaPat = await pat.PatchAsJsonAsync("/api/v1/me", new { displayName = "Hacked" }, _ct);
        var passwordViaPat = await pat.PostAsJsonAsync("/api/v1/me/password", new { currentPassword = user.Password, newPassword = IdentityTestApi.NewPassword }, _ct);
        var empty = await session.PatchAsJsonAsync("/api/v1/me", new { displayName = " " }, _ct);

        // Assert
        Assert.Equal("Renamed", renamed.DisplayName);
        Assert.Equal("Renamed", me.DisplayName);
        await viaPat.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
        await passwordViaPat.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
        await empty.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
    }

    [Fact]
    public async Task Sessions_issued_before_a_password_change_elsewhere_are_rejected_even_for_writes()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var stale = await api.LoginAsync(user);
        await api.WithDbAsync(async db =>
        {
            var entity = await db.Users.SingleAsync(u => u.Id == user.Id, _ct);
            entity.SetPasswordHash(entity.PasswordHash!);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var write = await stale.PostAsJsonAsync("/api/v1/projects", new { key = "STALE", name = "Stale" }, _ct);

        // Assert
        await write.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
    }
}
