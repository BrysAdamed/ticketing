using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Ticketing.Application.Achievements;

namespace Ticketing.Infrastructure.Maintenance;

public sealed class AchievementProjectorOptions
{
    public const string Section = "AchievementProjector";

    /// <summary>Run the projector in this instance (default true). Several instances are safe: cycles share an advisory lock.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Time between cycles (default 15 seconds); e2e runs lower it so an unlock shows within seconds.</summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromSeconds(15);

    /// <summary>Time of day (UTC) of the nightly safety sweep (default 03:00).</summary>
    public TimeSpan SweepAtUtc { get; set; } = TimeSpan.FromHours(3);
}

/// <summary>
/// Runs <see cref="AchievementProjection"/> after commit, on its own schedule (spec 15.8, D-149): a cycle every
/// <see cref="AchievementProjectorOptions.Interval"/> and the sweep once a day. A failure is logged and retried on the next tick;
/// it can never fail a user's write.
/// </summary>
internal sealed partial class AchievementProjector(
    IServiceScopeFactory scopes, IOptions<AchievementProjectorOptions> options, TimeProvider time, ILogger<AchievementProjector> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
            return;
        try
        {
            var nextSweep = NextSweep(time.GetUtcNow(), options.Value.SweepAtUtc);
            using var timer = new PeriodicTimer(options.Value.Interval, time);
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await RunAsync((p, ct) => p.RunCycleAsync(ct), sweep: false, stoppingToken);
                if (time.GetUtcNow() < nextSweep)
                    continue;
                await RunAsync((p, ct) => p.SweepAsync(ct), sweep: true, stoppingToken);
                nextSweep = NextSweep(time.GetUtcNow(), options.Value.SweepAtUtc);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private static DateTimeOffset NextSweep(DateTimeOffset now, TimeSpan atUtc)
    {
        var today = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero) + atUtc;
        return today > now ? today : today.AddDays(1);
    }

    private async Task RunAsync(Func<AchievementProjection, CancellationToken, Task<ProjectionResult>> work, bool sweep, CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var result = await work(scope.ServiceProvider.GetRequiredService<AchievementProjection>(), cancellationToken);
            if (sweep)
                LogSwept(logger, result.Users, result.Unlocked);
            else if (result.Unlocked > 0)
                LogUnlocked(logger, result.Unlocked, result.Users);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogFailed(logger, sweep ? "sweep" : "cycle", ex);
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Achievement projector unlocked {Unlocked} tiers for {Users} users.")]
    private static partial void LogUnlocked(ILogger logger, int unlocked, int users);

    [LoggerMessage(Level = LogLevel.Information, Message = "Achievement sweep evaluated {Users} users and unlocked {Unlocked} tiers.")]
    private static partial void LogSwept(ILogger logger, int users, int unlocked);

    [LoggerMessage(Level = LogLevel.Error, Message = "Achievement projector {Run} failed; it runs again at the next interval.")]
    private static partial void LogFailed(ILogger logger, string run, Exception exception);
}
