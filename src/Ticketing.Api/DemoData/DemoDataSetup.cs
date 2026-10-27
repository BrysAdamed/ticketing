using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Api.DemoData;

/// <summary>
/// Optional demo data for development, screenshots and demos; never enabled by default. Triggered by
/// <c>TICKETING_SEED_DEMO=true</c> (seeds at startup) or the <c>seed-demo</c> command (seeds and exits).
/// </summary>
public static class DemoDataSetup
{
    public const string SeedVariable = "TICKETING_SEED_DEMO";
    public const string PasswordVariable = "TICKETING_DEMO_PASSWORD";
    public const string SeedCommand = "seed-demo";

    public static IServiceCollection AddDemoData(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<DemoDataSeeder>();
        if (configuration.GetValue<bool>(SeedVariable))
            services.AddHostedService<DemoDataStartup>();
        return services;
    }

    public static bool IsSeedCommand(string[] args) =>
        args.Length > 0 && string.Equals(args[0], SeedCommand, StringComparison.OrdinalIgnoreCase);

    /// <summary>The <c>seed-demo</c> command: migrate, create the bootstrap admin when needed, seed, and return without serving requests.</summary>
    public static async Task RunSeedCommandAsync(this WebApplication app)
    {
        var stopping = app.Lifetime.ApplicationStopping;
        await using (var scope = app.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<DatabaseInitializer>().InitializeAsync(stopping);
        await app.Services.GetRequiredService<DemoDataSeeder>().SeedAsync(stopping);
    }
}

/// <summary>Seeds demo data at startup, after <see cref="DatabaseStartup"/> and before the server accepts requests.</summary>
internal sealed class DemoDataStartup(DemoDataSeeder seeder) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken) => seeder.SeedAsync(cancellationToken);

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
