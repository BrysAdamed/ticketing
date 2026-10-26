using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Auth;
using Ticketing.Domain.Users;
using Ticketing.Infrastructure.Persistence;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Auth;

[Collection(nameof(AuthCollection))]
public sealed class AuthTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Bootstrap_creates_admin_from_environment_when_user_table_is_empty()
    {
        // Act
        await using (var scope = api.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<DatabaseInitializer>().EnsureBootstrapAdminAsync(_ct);

        // Assert
        var admin = await api.WithDbAsync(db => db.Users.SingleAsync(_ct));
        Assert.Equal(TicketingApiFactory.BootstrapAdminEmail, admin.Email);
        Assert.Equal(GlobalRole.Admin, admin.GlobalRole);
        var client = await api.LoginAsync(new TestUser(admin.Id, admin.Email, TicketingApiFactory.BootstrapAdminPassword, admin.DisplayName, admin.GlobalRole));
        var me = await (await client.GetAsync("/api/v1/me", _ct)).ReadAsync<CurrentUserDto>();
        Assert.Equal(GlobalRole.Admin, me.GlobalRole);
    }

    [Fact]
    public async Task Bootstrap_does_nothing_when_users_exist()
    {
        // Arrange
        await api.CreateUserAsync();

        // Act
        await using (var scope = api.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<DatabaseInitializer>().EnsureBootstrapAdminAsync(_ct);

        // Assert
        Assert.Equal(1, await api.WithDbAsync(db => db.Users.CountAsync(_ct)));
    }

    [Fact]
    public async Task Login_returns_current_user_and_sets_session_and_xsrf_cookies()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = api.CreateBrowserClient();

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email.ToUpperInvariant(), password = user.Password }, _ct);

        // Assert
        var body = await response.ReadAsync<CurrentUserDto>();
        Assert.Equal(new CurrentUserDto(user.Id, user.Email, user.DisplayName, GlobalRole.User), body);
        var cookies = response.Headers.GetValues("Set-Cookie").ToList();
        Assert.Contains(cookies, c => c.StartsWith("tkt_session=", StringComparison.Ordinal) && c.Contains("httponly", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(cookies, c => c.StartsWith("XSRF-TOKEN=", StringComparison.Ordinal) && !c.Contains("httponly", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Login_with_wrong_password_returns_401_invalid_credentials()
    {
        // Arrange
        var user = await api.CreateUserAsync();

        // Act
        var response = await api.CreateBrowserClient().PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = "wrong-password-123" }, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.invalidCredentials");
    }

    [Fact]
    public async Task Login_with_unknown_email_returns_the_same_401()
    {
        // Act
        var response = await api.CreateBrowserClient().PostAsJsonAsync("/api/v1/auth/login", new { email = "nobody@ticketing.test", password = "whatever-password" }, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.invalidCredentials");
    }

    [Fact]
    public async Task Five_failed_logins_lock_the_account_even_for_the_correct_password()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = api.CreateBrowserClient();
        for (var i = 0; i < User.MaxFailedLogins - 1; i++)
            await (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = "wrong-password-123" }, _ct))
                .ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.invalidCredentials");

        // Act
        var locking = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = "wrong-password-123" }, _ct);
        var correct = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = user.Password }, _ct);

        // Assert
        await locking.ShouldBeProblemAsync(HttpStatusCode.Locked, "auth.lockedOut");
        await correct.ShouldBeProblemAsync(HttpStatusCode.Locked, "auth.lockedOut");
    }

    [Fact]
    public async Task Login_with_missing_fields_returns_validation_problem()
    {
        // Act
        var response = await api.CreateBrowserClient().PostAsJsonAsync("/api/v1/auth/login", new { email = "", password = "" }, _ct);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.True(problem.GetProperty("errors").TryGetProperty("email", out _));
        Assert.True(problem.GetProperty("errors").TryGetProperty("password", out _));
    }

    [Fact]
    public async Task Logout_ends_the_session()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var logout = await client.PostAsync("/api/v1/auth/logout", null, _ct);
        var me = await client.GetAsync("/api/v1/me", _ct);

        // Assert
        await logout.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await me.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.unauthenticated");
    }

    [Fact]
    public async Task Deactivated_user_loses_an_existing_session()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await api.WithDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == user.Id, _ct)).Deactivate(admin.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var response = await client.GetAsync("/api/v1/me", _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Csrf_endpoint_issues_a_readable_token_cookie()
    {
        // Act
        var response = await api.CreateBrowserClient().GetAsync("/api/v1/auth/csrf", _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        Assert.Contains(response.Headers.GetValues("Set-Cookie"), c => c.StartsWith("XSRF-TOKEN=", StringComparison.Ordinal));
    }
}
