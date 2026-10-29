using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.FeatureFlags;
using Ticketing.Domain.Achievements;

namespace Ticketing.Application.Achievements;

/// <summary>The feature flag of achievements (spec 15.1): a string-variant flag, <c>on</c> or <c>off</c>, evaluated per user.</summary>
public static class AchievementsFeature
{
    public const string FlagKey = "achievements";
}

/// <summary>
/// The single check every achievements entry point starts with: while <see cref="AchievementsFeature.FlagKey"/> is off for the
/// caller, everything about achievements is a 404 <c>achievements.disabled</c>, so the feature is neither visible nor callable.
/// </summary>
public sealed class AchievementsGate(IFeatureFlags flags, ITicketingDbContext db, ICurrentUser currentUser, IClock clock) : IFeatureGate
{
    public Task<bool> IsEnabledAsync(CancellationToken cancellationToken) => flags.IsOnAsync(AchievementsFeature.FlagKey, cancellationToken);

    public async Task EnsureEnabledAsync(CancellationToken cancellationToken)
    {
        if (!await IsEnabledAsync(cancellationToken))
            throw AppException.NotFound(AchievementErrors.Disabled, "Achievements are not available.");
    }

    /// <summary>
    /// <see cref="EnsureEnabledAsync"/>, then the caller's start (S, D-145): stamped now when the flag is seen on for a user
    /// who has none yet and has not opted out. Returns null for a user who opted out.
    /// </summary>
    public async Task<DateTimeOffset?> EnsureStartedAsync(CancellationToken cancellationToken)
    {
        await EnsureEnabledAsync(cancellationToken);
        DateTimeOffset? now = clock.Now;
        await db.Users
            .Where(u => u.Id == currentUser.Id && u.AchievementsStartedAt == null && !u.AchievementsHidden)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.AchievementsStartedAt, now), cancellationToken);
        return await db.Users.AsNoTracking().Where(u => u.Id == currentUser.Id).Select(u => u.AchievementsStartedAt).SingleAsync(cancellationToken);
    }
}
