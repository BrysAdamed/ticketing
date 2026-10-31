using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.FeatureFlags;
using Ticketing.Domain.Achievements;

namespace Ticketing.Application.Achievements;

/// <summary>
/// The single check every achievements entry point starts with: while <see cref="FeatureFlagCatalog.Achievements"/> is off for the
/// caller, everything about achievements is a 404 <c>achievements.disabled</c>, so the feature is neither visible nor callable.
/// </summary>
public sealed class AchievementsGate(IFeatureFlags flags, ITicketingDbContext db, ICurrentUser currentUser, IClock clock) : IFeatureGate
{
    public Task<bool> IsEnabledAsync(CancellationToken cancellationToken) => flags.IsOnAsync(FeatureFlagCatalog.Achievements, cancellationToken);

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

    /// <summary>
    /// <see cref="EnsureStartedAsync"/> for the caller's own achievements: a user who opted out gets the same 404
    /// <c>achievements.disabled</c> as while the flag is off. Returns the caller's start S.
    /// </summary>
    public async Task<DateTimeOffset> EnsureParticipatingAsync(CancellationToken cancellationToken) =>
        await EnsureStartedAsync(cancellationToken)
            ?? throw new AppException(ErrorKind.NotFound, AchievementErrors.Disabled, "You opted out of achievements.", "Opt back in from your profile to earn achievements again.");
}
