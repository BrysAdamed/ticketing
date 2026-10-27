using Microsoft.EntityFrameworkCore;
using Npgsql;
using Ticketing.Application;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Users;
using Ticketing.Infrastructure;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Api.DemoData;

/// <summary>The outcome of a demo seeding run.</summary>
public sealed record DemoSeedResult(bool Seeded, string Message);

/// <summary>
/// Fills an empty workspace with demo data (development and demos only): users, projects, tickets, boards, test cases,
/// regression sessions and feature flags, created through the application use cases as the demo users with backdated
/// timestamps. Runs only while no project exists, so it never touches real data, and holds a database lock so
/// several instances starting together seed once.
/// </summary>
public sealed partial class DemoDataSeeder(
    IConfiguration configuration,
    ILoggerFactory loggerFactory,
    IFeatureFlagStore flagStore,
    TimeProvider time)
{
    private const string LockKey = "ticketing.demo-seed";

    private readonly ILogger _logger = loggerFactory.CreateLogger<DemoDataSeeder>();

    public async Task<DemoSeedResult> SeedAsync(CancellationToken cancellationToken)
    {
        var connectionString = configuration.GetConnectionString("Db")
            ?? throw new InvalidOperationException("Connection string 'Db' is not configured (ConnectionStrings__Db).");
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await ExecuteAsync(connection, "SELECT pg_advisory_lock(hashtextextended(@key, 0))", cancellationToken);
        try
        {
            var result = await SeedLockedAsync(cancellationToken);
            LogResult(_logger, result.Message);
            return result;
        }
        finally
        {
            await ExecuteAsync(connection, "SELECT pg_advisory_unlock(hashtextextended(@key, 0))", CancellationToken.None);
        }
    }

    private async Task<DemoSeedResult> SeedLockedAsync(CancellationToken cancellationToken)
    {
        var clock = new DemoClock { Now = time.GetUtcNow() };
        var actors = new DemoActorHolder();
        await using var services = BuildServices(clock, actors);

        DemoActor admin;
        await using (var scope = services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TicketingDbContext>();
            if (await db.Projects.AnyAsync(cancellationToken))
                return new DemoSeedResult(false, "Demo data skipped: the workspace already has projects.");
            admin = await db.Users.AsNoTracking()
                .Where(u => u.GlobalRole == GlobalRole.Admin && u.IsActive)
                .OrderBy(u => u.CreatedAt)
                .Select(u => new DemoActor(u.Id, u.Email, u.DisplayName, u.GlobalRole))
                .FirstOrDefaultAsync(cancellationToken)
                ?? throw new InvalidOperationException("Demo data needs an active administrator; set the bootstrap admin variables.");
        }

        var password = configuration[DemoDataSetup.PasswordVariable] is { Length: > 0 } configured ? configured : null;
        var script = new DemoScript(new DemoWorkspace(services, clock, actors), admin, time.GetUtcNow(), password, _logger);
        var summary = await script.RunAsync(cancellationToken);
        flagStore.Invalidate();
        return new DemoSeedResult(true, $"Demo data seeded: {summary}.");
    }

    private ServiceProvider BuildServices(DemoClock clock, DemoActorHolder actors)
    {
        var services = new ServiceCollection();
        services.AddSingleton(configuration);
        services.AddSingleton(loggerFactory);
        services.AddSingleton(typeof(ILogger<>), typeof(Logger<>));
        services.AddSingleton<TimeProvider>(clock);
        services.AddApplication().AddInfrastructure(configuration);
        services.AddScoped<ICurrentUser>(_ => actors.Current ?? throw new InvalidOperationException("No demo user is acting."));
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = false });
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("key", LockKey);
        await command.ExecuteScalarAsync(cancellationToken);
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "{Message}")]
    private static partial void LogResult(ILogger logger, string message);
}
