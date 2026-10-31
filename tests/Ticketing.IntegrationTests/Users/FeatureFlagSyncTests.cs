using System.Net.Http.Headers;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.FeatureFlags;
using Ticketing.Application.Me;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Users;

[Collection(nameof(AdminCollection))]
public sealed class FeatureFlagSyncTests(TicketingApiFactory api)
{
    private static readonly FeatureFlagDefinition FreshOn = new("test.fresh-on", "Declared on in a later release", DefaultOn: true);
    private static readonly FeatureFlagDefinition FreshOff = new("test.fresh-off", "Declared off in a later release", DefaultOn: false);

    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_flag_declared_in_a_new_release_appears_with_its_default_at_startup_and_evaluates_without_any_admin_action()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var token = await api.CreatePatAsync(user);

        // Act
        await using var host = WithCatalog([.. FeatureFlagCatalog.All, FreshOn, FreshOff]);
        var client = host.CreateDefaultClient(new Uri("https://localhost"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var flags = (await (await client.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;

        // Assert
        var rows = await api.WithDbAsync(db => db.FeatureFlags.AsNoTracking().ToDictionaryAsync(f => f.Key, _ct));
        Assert.Equal((true, 100, (Guid?)null), (rows[FreshOn.Key].Enabled, rows[FreshOn.Key].RolloutPercentage, rows[FreshOn.Key].UpdatedById));
        Assert.Equal((false, 0, (Guid?)null), (rows[FreshOff.Key].Enabled, rows[FreshOff.Key].RolloutPercentage, rows[FreshOff.Key].UpdatedById));
        Assert.Equal("on", flags[FreshOn.Key]);
        Assert.Equal("off", flags[FreshOff.Key]);
        var registered = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.Action == FeatureFlagSync.RegisteredAction).ToListAsync(_ct));
        Assert.Equal(FeatureFlagCatalog.All.Count + 2, registered.Count);
        Assert.All(registered, a => Assert.Null(a.ActorId));
    }

    [Fact]
    public async Task A_declared_flag_without_a_row_evaluates_to_its_default_and_evaluation_writes_nothing()
    {
        // Arrange
        var user = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var flags = (await (await user.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;

        // Assert
        Assert.Equal(FeatureFlagCatalog.All.ToDictionary(d => d.Key, d => d.DefaultOn ? "on" : "off"), flags);
        Assert.False(await api.WithDbAsync(db => db.FeatureFlags.AnyAsync(_ct)));
    }

    [Fact]
    public async Task An_existing_row_keeps_the_admins_targeting_on_every_restart_and_only_takes_the_description_from_code()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var targeted = await api.CreateUserAsync();
        var configuredAt = DateTimeOffset.UtcNow.AddDays(-3);
        await api.WithDbAsync(async db =>
        {
            var flag = FeatureFlag.Register(FeatureFlagCatalog.AgentDelegate.Key, "Old description", defaultOn: false, configuredAt);
            flag.Configure(true, 25, [targeted.Id], [GlobalRole.Admin], admin.Id, configuredAt);
            db.FeatureFlags.Add(flag);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        await SyncAsync(api.Services);
        await SyncAsync(api.Services);
        await using (var restarted = WithCatalog(FeatureFlagCatalog.All))
            _ = restarted.Services;

        // Assert
        var row = await api.WithDbAsync(db => db.FeatureFlags.AsNoTracking().SingleAsync(f => f.Key == FeatureFlagCatalog.AgentDelegate.Key, _ct));
        Assert.Equal((true, 25, admin.Id), (row.Enabled, row.RolloutPercentage, row.UpdatedById));
        Assert.Equal([targeted.Id], row.TargetUserIds);
        Assert.Equal([GlobalRole.Admin], row.TargetRoles);
        Assert.Equal(configuredAt.ToUnixTimeMilliseconds(), row.UpdatedAt.ToUnixTimeMilliseconds());
        Assert.Equal(FeatureFlagCatalog.AgentDelegate.Description, row.Description);
        Assert.Equal(FeatureFlagCatalog.All.Count - 1, await api.WithDbAsync(db => db.ActivityEntries.CountAsync(a => a.Action == FeatureFlagSync.RegisteredAction, _ct)));
    }

    [Fact]
    public async Task A_flag_removed_from_the_catalog_keeps_its_row_as_retired_and_is_off()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var token = await api.CreatePatAsync(user);
        await SyncAsync(api.Services);

        // Act
        await using var host = WithCatalog([FeatureFlagCatalog.AgentDelegate, FeatureFlagCatalog.SubticketsGraph]);
        var client = host.CreateDefaultClient(new Uri("https://localhost"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var flags = (await (await client.GetAsync("/api/v1/me/flags", _ct)).ReadAsync<GetMyFlags.Result>()).Flags;
        bool achievementsOn;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var evaluated = await scope.ServiceProvider.GetRequiredService<IFeatureFlags>()
                .EvaluateForAsync(FeatureFlagCatalog.Achievements, [new FlagSubject(user.Id, user.Role)], _ct);
            achievementsOn = evaluated.Contains(user.Id);
        }

        // Assert
        Assert.False(flags.ContainsKey(FeatureFlagCatalog.Achievements.Key));
        Assert.False(achievementsOn);
        var row = await api.WithDbAsync(db => db.FeatureFlags.AsNoTracking().SingleAsync(f => f.Key == FeatureFlagCatalog.Achievements.Key, _ct));
        Assert.Equal((true, 100), (row.Enabled, row.RolloutPercentage));
    }

    [Fact]
    public async Task Concurrent_starts_register_each_declared_flag_once()
    {
        // Act
        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(() => SyncAsync(api.Services), _ct)));

        // Assert
        var keys = await api.WithDbAsync(db => db.FeatureFlags.Select(f => f.Key).ToListAsync(_ct));
        Assert.Equal(FeatureFlagCatalog.All.Select(d => d.Key).Order(StringComparer.Ordinal), keys.Order(StringComparer.Ordinal));
        Assert.Equal(FeatureFlagCatalog.All.Count, await api.WithDbAsync(db => db.ActivityEntries.CountAsync(a => a.Action == FeatureFlagSync.RegisteredAction, _ct)));
    }

    private WebApplicationFactory<Program> WithCatalog(IReadOnlyList<FeatureFlagDefinition> definitions) =>
        api.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IFeatureFlagCatalog>(new FeatureFlagCatalogSource(definitions))));

    private async Task SyncAsync(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<FeatureFlagSync>().EnsureAsync(_ct);
        scope.ServiceProvider.GetRequiredService<IFeatureFlagStore>().Invalidate();
    }
}
