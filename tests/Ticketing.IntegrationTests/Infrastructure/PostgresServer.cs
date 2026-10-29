using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.IntegrationTests.Infrastructure;

/// <summary>
/// One PostgreSQL 18 container per test run with a migrated template database. Every test collection gets its own
/// database cloned from the template (<c>CREATE DATABASE … TEMPLATE</c>), so collections run in parallel.
/// </summary>
internal static class PostgresServer
{
    private const string TemplateDatabase = "ticketing_template";
    private static readonly PostgreSqlContainer Container = new PostgreSqlBuilder("postgres:18-alpine").Build();
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static bool _started;

    public static Task<string> CreateDatabaseAsync(CancellationToken cancellationToken) =>
        CreateDatabaseAsync($"TEMPLATE {TemplateDatabase}", cancellationToken);

    /// <summary>A database without any migration applied, for tests that migrate step by step (data-rewriting migrations).</summary>
    public static Task<string> CreateEmptyDatabaseAsync(CancellationToken cancellationToken) =>
        CreateDatabaseAsync(string.Empty, cancellationToken);

    private static async Task<string> CreateDatabaseAsync(string options, CancellationToken cancellationToken)
    {
        await Gate.WaitAsync(cancellationToken);
        try
        {
            if (!_started)
            {
                await StartAsync(cancellationToken);
                _started = true;
            }

            var name = $"ticketing_{Guid.NewGuid():N}";
            await ExecuteAsync($"CREATE DATABASE \"{name}\" {options}", cancellationToken);
            return ConnectionString(name);
        }
        finally
        {
            Gate.Release();
        }
    }

    private static async Task StartAsync(CancellationToken cancellationToken)
    {
        await Container.StartAsync(cancellationToken);
        await ExecuteAsync($"CREATE DATABASE {TemplateDatabase}", cancellationToken);

        var options = new DbContextOptionsBuilder<TicketingDbContext>();
        TicketingDbContext.Configure(options, ConnectionString(TemplateDatabase, pooling: false));
        await using var db = new TicketingDbContext(options.Options);
        await db.Database.MigrateAsync(cancellationToken);
    }

    private static async Task ExecuteAsync(string sql, CancellationToken cancellationToken)
    {
        await using var connection = new NpgsqlConnection(ConnectionString("postgres", pooling: false));
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string ConnectionString(string database, bool pooling = true) =>
        new NpgsqlConnectionStringBuilder(Container.GetConnectionString()) { Database = database, Pooling = pooling }.ConnectionString;
}
