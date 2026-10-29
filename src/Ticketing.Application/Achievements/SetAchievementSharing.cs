using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Achievements;

namespace Ticketing.Application.Achievements;

/// <summary>
/// Shares or unshares one of the caller's earned achievements with every signed-in user (spec 15.7, D-150). Idempotent: sharing
/// keeps the first share time, unsharing an unshared achievement changes nothing. An unknown or unearned id is a 404
/// <c>achievements.notEarned</c>, so a secret achievement's id reveals nothing.
/// </summary>
public static class SetAchievementSharing
{
    /// <param name="Id">The achievement id, for example <c>reporter</c>.</param>
    /// <param name="Shared">True to share, false to unshare.</param>
    public sealed record Command(string? Id, bool Shared);

    public sealed class Handler(
        ITicketingDbContext db, AchievementsGate gate, AchievementEvaluator evaluator, ICurrentUser currentUser, IClock clock)
        : IHandler<Command, AchievementDto>
    {
        public async Task<AchievementDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var startedAt = await gate.EnsureParticipatingAsync(cancellationToken);
            currentUser.EnsureWriteScope();

            var me = currentUser.Id;
            var definition = AchievementCatalog.Find(command.Id ?? "") ?? throw NotEarned();
            var first = await db.UserAchievements
                .SingleOrDefaultAsync(a => a.UserId == me && a.AchievementId == definition.Id && a.Tier == 1, cancellationToken)
                ?? throw NotEarned();
            if (command.Shared)
                first.Share(clock.Now);
            else
                first.Unshare();
            await db.SaveChangesAsync(cancellationToken);

            return (await ListMyAchievements.LoadAsync(db, evaluator, me, startedAt, [definition], cancellationToken)).Single();
        }

        private static AppException NotEarned() =>
            AppException.NotFound(AchievementErrors.NotEarned, "You have not earned this achievement, so you cannot share it.");
    }
}
