using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;

namespace Ticketing.Application.Achievements;

/// <summary>
/// Marks every earned tier of the given achievements seen for the caller and returns what is still unseen (spec 15.6). Only the
/// caller's own rows are touched; unknown or unearned ids are ignored. A tier already seen keeps its time.
/// </summary>
public static class MarkAchievementsSeen
{
    public const int MaxIds = 100;

    /// <param name="Ids">Achievement ids (for example <c>reporter</c>), 1 to 100.</param>
    public sealed record Command(IReadOnlyList<string>? Ids) : IValidatable
    {
        public void Validate(Validator v)
        {
            var count = Ids?.Count ?? 0;
            v.Must(count > 0, "ids", "ids must name at least one achievement.");
            v.Must(count <= MaxIds, "ids", $"ids may name at most {MaxIds} achievements.");
        }
    }

    public sealed class Handler(ITicketingDbContext db, AchievementsGate gate, ICurrentUser currentUser, IClock clock) : IHandler<Command, UnseenAchievementsDto>
    {
        public async Task<UnseenAchievementsDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            await gate.EnsureParticipatingAsync(cancellationToken);
            currentUser.EnsureWriteScope();

            var me = currentUser.Id;
            var now = clock.Now;
            var ids = command.Ids!.Where(id => id is not null).Distinct(StringComparer.Ordinal).ToList();
            await db.UserAchievements
                .Where(a => a.UserId == me && a.SeenAt == null && ids.Contains(a.AchievementId))
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.SeenAt, now), cancellationToken);
            return await GetUnseenAchievements.UnseenAsync(db, me, cancellationToken);
        }
    }
}
