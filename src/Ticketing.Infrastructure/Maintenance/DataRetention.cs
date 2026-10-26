using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Ticketing.Domain.Tokens;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Infrastructure.Maintenance;

public sealed class MaintenanceOptions
{
    public const string Section = "Maintenance";

    /// <summary>Run the retention job in this instance (default true). Running it on several instances is harmless.</summary>
    public bool Enabled { get; set; } = true;

    public TimeSpan Interval { get; set; } = TimeSpan.FromHours(1);

    public TimeSpan InitialDelay { get; set; } = TimeSpan.FromMinutes(1);
}

public sealed record RetentionResult(int PurgedTokens, int PurgedIdempotencyRecords);

/// <summary>
/// Deletes data whose retention has ended: personal access tokens revoked or expired more than 90 days ago (spec 6.12)
/// and expired idempotency records (24 hours, spec 8).
/// </summary>
public sealed class DataRetention(TicketingDbContext db, TimeProvider time)
{
    public async Task<RetentionResult> PurgeAsync(CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var tokenCutoff = now - PersonalAccessToken.Retention;
        var tokens = await db.PersonalAccessTokens
            .Where(t => t.RevokedAt < tokenCutoff || t.ExpiresAt < tokenCutoff)
            .ExecuteDeleteAsync(cancellationToken);
        var idempotency = await db.IdempotencyRecords
            .Where(r => r.ExpiresAt <= now)
            .ExecuteDeleteAsync(cancellationToken);
        return new RetentionResult(tokens, idempotency);
    }
}

internal sealed partial class DataRetentionService(
    IServiceScopeFactory scopes, IOptions<MaintenanceOptions> options, TimeProvider time, ILogger<DataRetentionService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
            return;
        try
        {
            await Task.Delay(options.Value.InitialDelay, time, stoppingToken);
            using var timer = new PeriodicTimer(options.Value.Interval, time);
            do
            {
                await RunOnceAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task RunOnceAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var result = await scope.ServiceProvider.GetRequiredService<DataRetention>().PurgeAsync(cancellationToken);
            if (result.PurgedTokens + result.PurgedIdempotencyRecords > 0)
                LogPurged(logger, result.PurgedTokens, result.PurgedIdempotencyRecords);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogFailed(logger, ex);
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Retention job purged {Tokens} tokens and {IdempotencyRecords} idempotency records.")]
    private static partial void LogPurged(ILogger logger, int tokens, int idempotencyRecords);

    [LoggerMessage(Level = LogLevel.Error, Message = "Retention job failed; it runs again at the next interval.")]
    private static partial void LogFailed(ILogger logger, Exception exception);
}
