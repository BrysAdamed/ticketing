using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging;
using Npgsql;
using Respawn;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Agents;
using Ticketing.Infrastructure.Persistence;
using Xunit.v3;

namespace Ticketing.IntegrationTests.Infrastructure;

/// <summary>
/// One API host per test collection, on its own database cloned from the migrated template (see <see cref="PostgresServer"/>).
/// Every test starts from an empty database (Respawn) and creates what it needs through the <see cref="TestApi"/> helpers.
/// A feature declares its own collection (see <c>Collections.cs</c>), so feature test suites run in parallel.
/// </summary>
public sealed class TicketingApiFactory : WebApplicationFactory<Program>, IAsyncLifetime, INotifyTestLifecycleAsync
{
    public const string BootstrapAdminEmail = "bootstrap-admin@ticketing.test";
    public const string BootstrapAdminPassword = "Bootstrap-Admin-Password-1";
    public const string RemoteAddressHeader = "X-Test-Remote-Address";
    public const string PublicUrl = "https://ticketing.test";

    private Respawner _respawner = null!;

    public string ConnectionString { get; private set; } = string.Empty;

    /// <summary>What the host logged at Information and above (the production default level) since the current test started.</summary>
    public CapturedLogs Logs { get; } = new();

    public async ValueTask InitializeAsync()
    {
        ConnectionString = await PostgresServer.CreateDatabaseAsync(TestContext.Current.CancellationToken);
        _ = Server;

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        _respawner = await Respawner.CreateAsync(connection, new RespawnerOptions
        {
            DbAdapter = DbAdapter.Postgres,
            SchemasToInclude = ["public"],
            TablesToIgnore = ["__ef_migrations_history", "data_protection_keys"],
        });
    }

    public async ValueTask OnTestStartingAsync(IXunitTest test)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await _respawner.ResetAsync(connection);
        Services.GetRequiredService<IFeatureFlagStore>().Invalidate();
        Logs.Clear();
    }

    public ValueTask OnTestFinishedAsync(IXunitTest test) => ValueTask.CompletedTask;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Db", ConnectionString);
        builder.UseSetting(DatabaseInitializer.AdminEmailVariable, BootstrapAdminEmail);
        builder.UseSetting(DatabaseInitializer.AdminPasswordVariable, BootstrapAdminPassword);
        builder.UseSetting(AgentOptions.PublicUrlVariable, PublicUrl);
        builder.UseSetting("Auth:CookieSecurePolicy", "Always");
        builder.UseSetting("RateLimiting:LoginPermitsPerMinute", "100000");
        builder.UseSetting("Logging:Console:FormatterName", "simple");
        builder.UseSetting("Logging:LogLevel:Default", "Warning");
        builder.UseSetting("Logging:LogLevel:Microsoft.AspNetCore", "Error");
        builder.ConfigureLogging(logging => logging
            .AddProvider(Logs)
            .AddFilter<CapturedLogs>(null, LogLevel.Information)
            .AddFilter<CapturedLogs>("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Warning));
        builder.ConfigureServices(services => services.AddSingleton<IStartupFilter, RemoteAddressStartupFilter>());
    }

    /// <summary>
    /// The test server has no TCP connection; a request may name its remote address in <see cref="RemoteAddressHeader"/>.
    /// It is applied before any app middleware, so forwarded-header handling sees it like a real peer address.
    /// </summary>
    private sealed class RemoteAddressStartupFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((context, nextMiddleware) =>
            {
                if (IPAddress.TryParse(context.Request.Headers[RemoteAddressHeader].ToString(), out var address))
                    context.Connection.RemoteIpAddress = address;
                return nextMiddleware(context);
            });
            next(app);
        };
    }
}
