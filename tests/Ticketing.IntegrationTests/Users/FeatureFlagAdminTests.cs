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
    public async Task Admin_sees_every_declared_flag_with_its_default_without_creating_anything()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        await api.CreateUserAsync();

        // Act
        var list = await (await admin.GetAsync("/api/v1/admin/flags", _ct)).ReadAsync<List<FlagDto>>();

        // Assert
        Assert.Equal(FeatureFlagCatalog.All.Select(d => d.Key).Order(StringComparer.Ordinal), list.Select(f => f.Key));
        Assert.All(list, f =>
        {
            var declared = FeatureFlagCatalog.All.Single(d => d.Key == f.Key);
            Assert.Equal((declared.DefaultOn, declared.DefaultOn ? 100 : 0), (f.Enabled, f.RolloutPercentage));
            Assert.Equal((declared.DefaultOn, false, true), (f.DefaultOn!.Value, f.Retired, f.IsDefault));
            Assert.Equal(declared.Description, f.Description);
            Assert.Null(f.UpdatedBy);
            Assert.Equal(declared.DefaultOn ? 2 : 0, f.UsersOn);
        });
        var registered = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.Action == FeatureFlagSync.RegisteredAction).ToListAsync(_ct));
        Assert.Equal(FeatureFlagCatalog.All.Count, registered.Count);
        Assert.All(registered, a => Assert.Null(a.ActorId));
    }

    [Fact]
    public async Task Changing_targeting_takes_effect_immediately_and_records_each_field()
    {
        // Arrange
        var key = FeatureFlagCatalog.AgentDelegate.Key;
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var user = await api.LoginAsync(await api.CreateUserAsync());
        var before = (await (await user.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;
        var current = await (await admin.GetAsync($"/api/v1/admin/flags/{key}", _ct)).ReadAsync<FlagDto>();

        // Act
        var request = new HttpRequestMessage(HttpMethod.Patch, $"/api/v1/admin/flags/{key}")
        {
            Content = JsonContent.Create(new { enabled = true, rolloutPercentage = 100, description = "Ignored" }),
        };
        request.Headers.IfMatch.ParseAdd($"\"{current.RowVersion}\"");
        var updated = await (await admin.SendAsync(request, _ct)).ReadAsync<FlagDto>();
        var after = (await (await user.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;
        var stale = new HttpRequestMessage(HttpMethod.Patch, $"/api/v1/admin/flags/{key}") { Content = JsonContent.Create(new { enabled = false }) };
        stale.Headers.IfMatch.ParseAdd($"\"{current.RowVersion}\"");
        var staleResponse = await admin.SendAsync(stale, _ct);

        // Assert
        Assert.Equal("off", before[key]);
        Assert.Equal("on", after[key]);
        Assert.Equal(2, updated.UsersOn);
        Assert.Equal(FeatureFlagCatalog.AgentDelegate.Description, updated.Description);
        Assert.False(updated.IsDefault);
        await staleResponse.ShouldBeProblemAsync(HttpStatusCode.Conflict, "concurrency.conflict");
        var fields = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.Action == "flag.updated").Select(a => a.Field).ToListAsync(_ct));
        Assert.Equal(["enabled", "rolloutPercentage"], fields.Order());
    }

    [Fact]
    public async Task Reset_restores_the_code_default_clears_targeting_and_is_audited()
    {
        // Arrange
        var key = FeatureFlagCatalog.SubticketsGraph.Key;
        var adminUser = await api.CreateUserAsync(GlobalRole.Admin);
        var admin = await api.LoginAsync(adminUser);
        var user = await api.CreateUserAsync();
        await (await admin.PatchAsJsonAsync($"/api/v1/admin/flags/{key}",
            new { enabled = false, rolloutPercentage = 10, targetUserIds = new[] { user.Id }, targetRoles = new[] { "Admin" } }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var reset = await (await admin.PostAsync($"/api/v1/admin/flags/{key}/reset", null, _ct)).ReadAsync<FlagDto>();
        var flags = (await (await admin.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;

        // Assert
        Assert.Equal((true, 100, true), (reset.Enabled, reset.RolloutPercentage, reset.IsDefault));
        Assert.Empty(reset.TargetUsers);
        Assert.Empty(reset.TargetRoles);
        Assert.Equal(adminUser.Id, reset.UpdatedBy!.Id);
        Assert.Equal("on", flags[key]);
        var entry = await api.WithDbAsync(db => db.ActivityEntries.SingleAsync(a => a.Action == ResetFlag.Action, _ct));
        Assert.Equal(adminUser.Id, entry.ActorId);
        Assert.Contains("\"enabled\": false", entry.OldValue);
        Assert.Contains("\"enabled\": true", entry.NewValue);
    }

    [Fact]
    public async Task Only_retired_flags_are_deleted_and_they_are_off_and_hidden_from_users()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        await api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            db.FeatureFlags.Add(FeatureFlag.Register("old.feature", "Gone from the code", defaultOn: true, now));
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var list = await (await admin.GetAsync("/api/v1/admin/flags", _ct)).ReadAsync<List<FlagDto>>();
        var mine = (await (await admin.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;
        var deleteDeclared = await admin.DeleteAsync($"/api/v1/admin/flags/{FeatureFlagCatalog.AgentDelegate.Key}", _ct);
        var resetRetired = await admin.PostAsync("/api/v1/admin/flags/old.feature/reset", null, _ct);
        var deleteRetired = await admin.DeleteAsync("/api/v1/admin/flags/old.feature", _ct);
        var missing = await admin.GetAsync("/api/v1/admin/flags/old.feature", _ct);

        // Assert
        var retired = list[^1];
        Assert.Equal(("old.feature", true, (bool?)null, false, 0), (retired.Key, retired.Retired, retired.DefaultOn, retired.IsDefault, retired.UsersOn));
        Assert.All(list[..^1], f => Assert.False(f.Retired));
        Assert.False(mine.ContainsKey("old.feature"));
        await deleteDeclared.ShouldBeProblemAsync(HttpStatusCode.Conflict, FeatureFlagErrors.NotRetired);
        await resetRetired.ShouldBeProblemAsync(HttpStatusCode.Conflict, FeatureFlagErrors.Retired);
        await deleteRetired.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, FeatureFlagErrors.NotFound);
        Assert.Equal(1, await api.ActivityCountAsync("flag.deleted"));
        Assert.Equal(FeatureFlagCatalog.All.Count, await api.WithDbAsync(db => db.FeatureFlags.CountAsync(_ct)));
    }

    [Fact]
    public async Task There_is_no_way_to_create_a_flag()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));

        // Act
        var response = await admin.PostAsJsonAsync("/api/v1/admin/flags", new { key = "board.swimlanes" }, _ct);

        // Assert
        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
        Assert.False(await api.WithDbAsync(db => db.FeatureFlags.AnyAsync(f => f.Key == "board.swimlanes", _ct)));
    }

    [Fact]
    public async Task Targeting_input_is_validated()
    {
        // Arrange
        var key = FeatureFlagCatalog.AgentDelegate.Key;
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));

        // Act
        var badRollout = await admin.PatchAsJsonAsync($"/api/v1/admin/flags/{key}", new { rolloutPercentage = 101 }, _ct);
        var unknownUser = await admin.PatchAsJsonAsync($"/api/v1/admin/flags/{key}", new { targetUserIds = new[] { Guid.NewGuid() } }, _ct);
        var unknownFlag = await admin.PatchAsJsonAsync("/api/v1/admin/flags/not.declared", new { enabled = true }, _ct);

        // Assert
        await badRollout.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        await unknownUser.ShouldBeProblemAsync(HttpStatusCode.BadRequest, FeatureFlagErrors.UnknownTargetUsers);
        await unknownFlag.ShouldBeProblemAsync(HttpStatusCode.NotFound, FeatureFlagErrors.NotFound);
    }

    [Fact]
    public async Task Flags_are_managed_by_admins_in_the_web_app_only()
    {
        // Arrange
        var key = FeatureFlagCatalog.AgentDelegate.Key;
        var adminUser = await api.CreateUserAsync(GlobalRole.Admin);
        var user = await api.LoginAsync(await api.CreateUserAsync());
        var pat = await api.CreatePatClientAsync(adminUser);

        // Act
        var list = await user.GetAsync("/api/v1/admin/flags", _ct);
        var patch = await user.PatchAsJsonAsync($"/api/v1/admin/flags/{key}", new { enabled = true }, _ct);
        var reset = await user.PostAsync($"/api/v1/admin/flags/{key}/reset", null, _ct);
        var delete = await user.DeleteAsync($"/api/v1/admin/flags/{key}", _ct);
        var asPat = await pat.GetAsync("/api/v1/admin/flags", _ct);
        var resetAsPat = await pat.PostAsync($"/api/v1/admin/flags/{key}/reset", null, _ct);

        // Assert
        await list.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "forbidden");
        await patch.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "forbidden");
        await reset.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "forbidden");
        await delete.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "forbidden");
        await asPat.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
        await resetAsPat.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
        Assert.False(await api.WithDbAsync(db => db.FeatureFlags.AnyAsync(f => f.Enabled && f.Key == key, _ct)));
    }
}
