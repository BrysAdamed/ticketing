using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Achievements;

/// <summary>
/// Opting out of and back into achievements (spec 15.11, D-153). Every write path that changes the choice goes through here,
/// inside the caller's transaction, so the rule is the same wherever it is changed.
/// </summary>
public static class AchievementParticipation
{
    /// <summary>
    /// Opting out sets <c>achievements_hidden</c>, clears the start S and deletes every <c>user_achievements</c> row of the user,
    /// shares included. It holds the projector's lock, so a running cycle cannot insert a tier after the delete. Opting in clears
    /// the opt-out and sets S to <paramref name="now"/>, so counting restarts from zero. Both are idempotent.
    /// Must run inside <c>InTransactionAsync</c>; the caller saves the tracked <paramref name="user"/>.
    /// </summary>
    public static async Task SetHiddenAsync(ITicketingDbContext db, User user, bool hidden, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (!hidden)
        {
            user.OptInToAchievements(now);
            return;
        }

        await AchievementProjection.LockAsync(db, cancellationToken);
        user.OptOutOfAchievements();
        await db.UserAchievements.Where(a => a.UserId == user.Id).ExecuteDeleteAsync(cancellationToken);
    }
}
