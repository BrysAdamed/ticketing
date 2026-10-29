using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Achievements;

namespace Ticketing.Application.Achievements;

/// <summary>
/// The caller's earned tiers they have not seen yet, for the unlock toast's poll (spec 15.6): one primary-key range read, no
/// criteria evaluated, so it stays as cheap as the notification unread count.
/// </summary>
public static class GetUnseenAchievements
{
    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db, AchievementsGate gate, ICurrentUser currentUser) : IHandler<Query, UnseenAchievementsDto>
    {
        public async Task<UnseenAchievementsDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            await gate.EnsureParticipatingAsync(cancellationToken);
            return await UnseenAsync(db, currentUser.Id, cancellationToken);
        }
    }

    internal static async Task<UnseenAchievementsDto> UnseenAsync(ITicketingDbContext db, Guid userId, CancellationToken cancellationToken)
    {
        var rows = await db.UserAchievements
            .AsNoTracking()
            .Where(a => a.UserId == userId && a.SeenAt == null)
            .OrderBy(a => a.UnlockedAt).ThenBy(a => a.AchievementId).ThenBy(a => a.Tier)
            .Select(a => new { a.AchievementId, a.Tier })
            .ToListAsync(cancellationToken);
        List<UnseenAchievementDto> items =
        [
            .. from row in rows
            let definition = AchievementCatalog.Find(row.AchievementId)
            where definition is not null
            select new UnseenAchievementDto(definition.Id, definition.Name, row.Tier, definition.Icon),
        ];
        return new UnseenAchievementsDto(items.Count, items);
    }
}
