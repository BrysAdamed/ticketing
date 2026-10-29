using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.Me;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Me;

[Collection(nameof(AuthCollection))]
public sealed class MeTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Me_returns_the_signed_in_user()
    {
        // Arrange
        var user = await api.CreateUserAsync(GlobalRole.Admin);
        var client = await api.LoginAsync(user);

        // Act
        var me = await (await client.GetAsync("/api/v1/me", _ct)).ReadAsync<CurrentUserDto>();

        // Assert
        Assert.Equal(new CurrentUserDto(user.Id, user.Email, user.DisplayName, GlobalRole.Admin, false), me);
    }

    [Fact]
    public async Task Me_works_with_a_personal_access_token()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.CreatePatClientAsync(user, PatScope.ReadOnly);

        // Act
        var me = await (await client.GetAsync("/api/v1/me", _ct)).ReadAsync<CurrentUserDto>();

        // Assert
        Assert.Equal(user.Id, me.Id);
    }

    [Fact]
    public async Task Anonymous_requests_get_401_problem()
    {
        // Act
        var response = await api.CreateBrowserClient().GetAsync("/api/v1/me", _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.unauthenticated");
    }

    [Fact]
    public async Task Invalid_token_gets_401_with_bearer_challenge()
    {
        // Act
        var response = await api.CreateBearerClient("tkt_" + new string('x', 40)).GetAsync("/api/v1/me", _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
    }

    [Fact]
    public async Task Patch_me_changes_the_display_name_and_records_it()
    {
        // Arrange
        var user = await api.CreateUserAsync(displayName: "Old Name");
        var client = await api.LoginAsync(user);

        // Act
        var me = await (await client.PatchAsJsonAsync("/api/v1/me", new { displayName = "  New Name " }, _ct)).ReadAsync<CurrentUserDto>();

        // Assert
        Assert.Equal(new CurrentUserDto(user.Id, user.Email, "New Name", GlobalRole.User, false), me);
        var entry = await api.WithDbAsync(db => db.ActivityEntries.SingleAsync(a => a.EntityId == user.Id && a.Action == "user.field.changed", _ct));
        Assert.Equal("displayName", entry.Field);
    }

    [Fact]
    public async Task Patch_me_without_fields_changes_nothing()
    {
        // Arrange
        var user = await api.CreateUserAsync(displayName: "Kept Name");
        var client = await api.LoginAsync(user);

        // Act
        var me = await (await client.PatchAsJsonAsync("/api/v1/me", new { }, _ct)).ReadAsync<CurrentUserDto>();

        // Assert
        Assert.Equal("Kept Name", me.DisplayName);
        Assert.False(await api.WithDbAsync(db => db.ActivityEntries.AnyAsync(a => a.EntityId == user.Id && a.Action == "user.field.changed", _ct)));
    }

    [Fact]
    public async Task Patch_me_rejects_an_empty_display_name()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await client.PatchAsJsonAsync("/api/v1/me", new { displayName = "" }, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
    }

    [Fact]
    public async Task Patch_me_is_web_session_only()
    {
        // Arrange
        var user = await api.CreateUserAsync(displayName: "Pat User");
        var client = await api.CreatePatClientAsync(user);

        // Act
        var response = await client.PatchAsJsonAsync("/api/v1/me", new { displayName = "Changed" }, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.CookieSessionRequired);
    }

    [Fact]
    public async Task Flags_are_evaluated_per_user_by_switch_targets_and_rollout()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var user = await api.CreateUserAsync();
        await api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            db.FeatureFlags.AddRange(
                Flag("disabled", enabled: false, rollout: 100, users: [user.Id], roles: [], now),
                Flag("for-user", enabled: true, rollout: 0, users: [user.Id], roles: [], now),
                Flag("for-admins", enabled: true, rollout: 0, users: [], roles: [GlobalRole.Admin], now),
                Flag("everyone", enabled: true, rollout: 100, users: [], roles: [], now),
                Flag("nobody", enabled: true, rollout: 0, users: [], roles: [], now));
            return await db.SaveChangesAsync(_ct);
        });
        var userClient = await api.LoginAsync(user);
        var adminClient = await api.LoginAsync(admin);

        // Act
        var userFlags = (await (await userClient.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;
        var adminFlags = (await (await adminClient.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;

        // Assert
        Assert.Equal(
            new Dictionary<string, string> { ["disabled"] = "off", ["everyone"] = "on", ["for-admins"] = "off", ["for-user"] = "on", ["nobody"] = "off" },
            userFlags);
        Assert.Equal("on", adminFlags["for-admins"]);
        Assert.Equal("off", adminFlags["for-user"]);
    }

    private static FeatureFlag Flag(string key, bool enabled, int rollout, Guid[] users, GlobalRole[] roles, DateTimeOffset now)
    {
        var flag = FeatureFlag.Create(key, null, null, now);
        flag.Configure(null, enabled, rollout, users, roles, null, now);
        return flag;
    }
}
