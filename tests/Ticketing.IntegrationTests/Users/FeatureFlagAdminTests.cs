using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.FeatureFlags;
using Ticketing.Application.Me;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Users;

[Collection(nameof(AdminCollection))]
public sealed class FeatureFlagAdminTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Admin_creates_lists_and_counts_users_on()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var targeted = await api.CreateUserAsync();
        await api.CreateUserAsync();
        var inactive = await api.CreateUserAsync();
        await (await admin.PostAsync($"/api/v1/admin/users/{inactive.Id}/deactivate", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var created = await (await admin.PostAsJsonAsync("/api/v1/admin/flags", new
        {
            key = "board.swimlanes",
            description = "Swimlanes on boards",
            enabled = true,
            rolloutPercentage = 0,
            targetUserIds = new[] { targeted.Id, inactive.Id },
            targetRoles = new[] { "Admin" },
        }, _ct)).ReadAsync<FlagDto>(HttpStatusCode.Created);
        var list = await (await admin.GetAsync("/api/v1/admin/flags", _ct)).ReadAsync<List<FlagDto>>();

        // Assert
        Assert.Equal("board.swimlanes", created.Key);
        Assert.Equal(2, created.UsersOn);
        Assert.Equal(3, created.ActiveUsers);
        Assert.Equal(2, created.TargetUsers.Count);
        Assert.Equal([GlobalRole.Admin], created.TargetRoles);
        Assert.Equal(created.Id, Assert.Single(list).Id);
        Assert.Equal(1, await api.ActivityCountAsync("flag.created"));
    }

    [Fact]
    public async Task Updating_a_flag_takes_effect_immediately_and_records_each_field()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var user = await api.LoginAsync(await api.CreateUserAsync());
        await (await admin.PostAsJsonAsync("/api/v1/admin/flags", new { key = "ticket-view.v2" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);
        var before = (await (await user.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;
        var current = await (await admin.GetAsync("/api/v1/admin/flags/ticket-view.v2", _ct)).ReadAsync<FlagDto>();

        // Act
        var request = new HttpRequestMessage(HttpMethod.Patch, "/api/v1/admin/flags/ticket-view.v2")
        {
            Content = JsonContent.Create(new { enabled = true, rolloutPercentage = 100, description = "New ticket view" }),
        };
        request.Headers.IfMatch.ParseAdd($"\"{current.RowVersion}\"");
        var updated = await (await admin.SendAsync(request, _ct)).ReadAsync<FlagDto>();
        var after = (await (await user.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;
        var stale = new HttpRequestMessage(HttpMethod.Patch, "/api/v1/admin/flags/ticket-view.v2") { Content = JsonContent.Create(new { enabled = false }) };
        stale.Headers.IfMatch.ParseAdd($"\"{current.RowVersion}\"");
        var staleResponse = await admin.SendAsync(stale, _ct);

        // Assert
        Assert.Equal("off", before["ticket-view.v2"]);
        Assert.Equal("on", after["ticket-view.v2"]);
        Assert.Equal(2, updated.UsersOn);
        await staleResponse.ShouldBeProblemAsync(HttpStatusCode.Conflict, "concurrency.conflict");
        var fields = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.Action == "flag.updated").Select(a => a.Field).ToListAsync(_ct));
        Assert.Equal(["description", "enabled", "rolloutPercentage"], fields.Order());
    }

    [Fact]
    public async Task Deleting_a_flag_turns_it_off_and_is_audited()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        await (await admin.PostAsJsonAsync("/api/v1/admin/flags", new { key = "gone", enabled = true, rolloutPercentage = 100 }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var deleted = await admin.DeleteAsync("/api/v1/admin/flags/gone", _ct);
        var flags = (await (await admin.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;
        var missing = await admin.GetAsync("/api/v1/admin/flags/gone", _ct);

        // Assert
        await deleted.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        Assert.False(flags.ContainsKey("gone"));
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, FeatureFlagErrors.NotFound);
        Assert.Equal(1, await api.ActivityCountAsync("flag.deleted"));
    }

    [Fact]
    public async Task Flag_input_is_validated()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        await (await admin.PostAsJsonAsync("/api/v1/admin/flags", new { key = "taken" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var badKey = await admin.PostAsJsonAsync("/api/v1/admin/flags", new { key = "Bad Key" }, _ct);
        var taken = await admin.PostAsJsonAsync("/api/v1/admin/flags", new { key = "taken" }, _ct);
        var badRollout = await admin.PostAsJsonAsync("/api/v1/admin/flags", new { key = "rollout", rolloutPercentage = 101 }, _ct);
        var unknownUser = await admin.PostAsJsonAsync("/api/v1/admin/flags", new { key = "unknown-user", targetUserIds = new[] { Guid.NewGuid() } }, _ct);

        // Assert
        await badKey.ShouldBeProblemAsync(HttpStatusCode.BadRequest, FeatureFlagErrors.KeyInvalid);
        await taken.ShouldBeProblemAsync(HttpStatusCode.Conflict, FeatureFlagErrors.KeyTaken);
        await badRollout.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        await unknownUser.ShouldBeProblemAsync(HttpStatusCode.BadRequest, FeatureFlagErrors.UnknownTargetUsers);
    }

    [Fact]
    public async Task Flags_are_managed_by_admins_in_the_web_app_only()
    {
        // Arrange
        var adminUser = await api.CreateUserAsync(GlobalRole.Admin);
        var user = await api.LoginAsync(await api.CreateUserAsync());
        var pat = await api.CreatePatClientAsync(adminUser);

        // Act
        var asUser = await user.PostAsJsonAsync("/api/v1/admin/flags", new { key = "nope" }, _ct);
        var asPat = await pat.GetAsync("/api/v1/admin/flags", _ct);

        // Assert
        await asUser.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "forbidden");
        await asPat.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
    }
}
