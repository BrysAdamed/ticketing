using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using Respawn;
using Testcontainers.PostgreSql;
using Ticketing.Infrastructure.Persistence;
using Xunit.v3;

namespace Ticketing.IntegrationTests.Infrastructure;

/// <summary>
/// One API host on one PostgreSQL 18 container for the whole test run. Every test starts from an empty database
/// (Respawn), and creates the users and data it needs through <see cref="TestApi"/> helpers.
/// </summary>
public sealed partial class TicketingApiFactory : WebApplicationFactory<Program>, IAsyncLifetime, INotifyTestLifecycleAsync
{
    public const string BootstrapAdminEmail = "bootstrap-admin@ticketing.test";
    public const string BootstrapAdminPassword = "Bootstrap-Admin-Password-1";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:18-alpine").Build();
    private Respawner _respawner = null!;

    public string ConnectionString => _postgres.GetConnectionString();

    public async ValueTask InitializeAsync()
    {
        await _postgres.StartAsync();
        _ = Server;

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        _respawner = await Respawner.CreateAsync(connection, new RespawnerOptions
        {
            DbAdapter = DbAdapter.Postgres,
            SchemasToInclude = ["public"],
            TablesToIgnore = ["__ef_migrations_history"],
        });
    }

    public async ValueTask OnTestStartingAsync(IXunitTest test)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await _respawner.ResetAsync(connection);
        Services.GetRequiredService<Ticketing.Application.Abstractions.IFeatureFlagStore>().Invalidate();
    }

    public ValueTask OnTestFinishedAsync(IXunitTest test) => ValueTask.CompletedTask;

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Db", ConnectionString);
        builder.UseSetting(DatabaseInitializer.AdminEmailVariable, BootstrapAdminEmail);
        builder.UseSetting(DatabaseInitializer.AdminPasswordVariable, BootstrapAdminPassword);
        builder.UseSetting("Auth:CookieSecurePolicy", "Always");
        builder.UseSetting("Logging:Console:FormatterName", "simple");
        builder.UseSetting("Logging:LogLevel:Default", "Warning");
        builder.UseSetting("Logging:LogLevel:Microsoft.AspNetCore", "Error");
    }
}

[CollectionDefinition(nameof(ApiCollection))]
public sealed class ApiCollection : ICollectionFixture<TicketingApiFactory>;
