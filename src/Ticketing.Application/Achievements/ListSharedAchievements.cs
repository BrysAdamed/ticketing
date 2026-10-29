using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.FeatureFlags;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Achievements;

/// <summary>
/// A user's shared achievements, for any signed-in user (spec 15.7, D-150): id, name, icon and the highest tier, in catalogue
/// order, never dates. Admins see no more than anyone else. The viewer needs the flag on; an owner who is unknown, deactivated,
/// opted out or has the flag off is a 404 <c>user.notFound</c>, so the answer never tells which.
/// </summary>
public static class ListSharedAchievements
{
    public sealed record Query(Guid UserId);

    public sealed class Handler(ITicketingDbContext db, AchievementsGate gate, IFeatureFlags flags) : IHandler<Query, SharedAchievementsDto>
    {
        public async Task<SharedAchievementsDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            await gate.EnsureEnabledAsync(cancellationToken);

            var owner = await db.Users
                .AsNoTracking()
                .Where(u => u.Id == request.UserId && u.IsActive && !u.AchievementsHidden)
                .Select(u => new FlagSubject(u.Id, u.GlobalRole))
                .SingleOrDefaultAsync(cancellationToken);
            if (owner is null || !(await flags.EvaluateForAsync(AchievementsFeature.FlagKey, [owner], cancellationToken)).Contains(owner.UserId))
                throw AppException.NotFound(UserErrors.NotFound, "User not found.");

            var tiers = await db.UserAchievements
                .AsNoTracking()
                .Where(a => a.UserId == owner.UserId)
                .GroupBy(a => a.AchievementId)
                .Where(g => g.Any(a => a.SharedAt != null))
                .Select(g => new { AchievementId = g.Key, Tier = g.Max(a => a.Tier) })
                .ToDictionaryAsync(a => a.AchievementId, a => (int)a.Tier, StringComparer.Ordinal, cancellationToken);

            return new SharedAchievementsDto([
                .. AchievementCatalog.All
                    .Where(d => tiers.ContainsKey(d.Id))
                    .Select(d => new SharedAchievementDto(d.Id, d.Name, d.Icon, tiers[d.Id])),
            ]);
        }
    }
}
