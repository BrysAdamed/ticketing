using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Achievements;

namespace Ticketing.Application.Achievements;

/// <summary>
/// The caller's achievements (spec 15.6): the catalogue with the tiers they earned and their live progress, counted from their
/// start S. Always the caller's own; the first call stamps S (D-145). Secret entries stay masked until earned.
/// </summary>
public static class ListMyAchievements
{
    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db, AchievementsGate gate, AchievementEvaluator evaluator, ICurrentUser currentUser)
        : IHandler<Query, MyAchievementsDto>
    {
        public async Task<MyAchievementsDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var startedAt = await gate.EnsureParticipatingAsync(cancellationToken);
            var me = currentUser.Id;

            var earned = (await db.UserAchievements
                    .AsNoTracking()
                    .Where(a => a.UserId == me)
                    .Select(a => new { a.AchievementId, a.Tier, a.UnlockedAt, a.SeenAt })
                    .ToListAsync(cancellationToken))
                .ToLookup(a => a.AchievementId, a => new EarnedTier(a.Tier, a.UnlockedAt, a.SeenAt), StringComparer.Ordinal);
            var visible = AchievementCatalog.All.Where(d => !d.Secret || earned.Contains(d.Id)).Select(d => d.Id).ToList();
            var counts = (await evaluator.EvaluateAsync([new AchievementSubject(me, startedAt)], visible, cancellationToken))
                .ToDictionary(p => p.AchievementId, p => p.Count, StringComparer.Ordinal);

            return new MyAchievementsDto(
                startedAt,
                [.. AchievementCatalog.All.Select(d => AchievementDto.From(d, [.. earned[d.Id]], counts.GetValueOrDefault(d.Id)))]);
        }
    }
}
