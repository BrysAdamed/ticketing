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
            return new MyAchievementsDto(
                startedAt,
                await LoadAsync(db, evaluator, currentUser.Id, startedAt, AchievementCatalog.All, cancellationToken));
        }
    }

    /// <summary>The <see cref="AchievementDto"/> of each of <paramref name="definitions"/> for <paramref name="userId"/>, in the given order.</summary>
    internal static async Task<IReadOnlyList<AchievementDto>> LoadAsync(
        ITicketingDbContext db,
        AchievementEvaluator evaluator,
        Guid userId,
        DateTimeOffset startedAt,
        IReadOnlyList<AchievementDefinition> definitions,
        CancellationToken cancellationToken)
    {
        var ids = definitions.Select(d => d.Id).ToList();
        var rows = await db.UserAchievements
            .AsNoTracking()
            .Where(a => a.UserId == userId && ids.Contains(a.AchievementId))
            .Select(a => new { a.AchievementId, a.Tier, a.UnlockedAt, a.SeenAt, a.SharedAt })
            .ToListAsync(cancellationToken);
        var earned = rows.ToLookup(a => a.AchievementId, a => new EarnedTier(a.Tier, a.UnlockedAt, a.SeenAt), StringComparer.Ordinal);
        var shared = rows.Where(a => a.SharedAt != null).Select(a => a.AchievementId).ToHashSet(StringComparer.Ordinal);
        var visible = definitions.Where(d => !d.Secret || earned.Contains(d.Id)).Select(d => d.Id).ToList();
        var counts = (await evaluator.EvaluateAsync([new AchievementSubject(userId, startedAt)], visible, cancellationToken))
            .ToDictionary(p => p.AchievementId, p => p.Count, StringComparer.Ordinal);

        return [.. definitions.Select(d => AchievementDto.From(d, [.. earned[d.Id]], counts.GetValueOrDefault(d.Id), shared.Contains(d.Id)))];
    }
}
