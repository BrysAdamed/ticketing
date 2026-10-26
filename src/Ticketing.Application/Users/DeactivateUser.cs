using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Users;

/// <summary>
/// Deactivation (spec 4.1, 6.12, D-41): blocks login, ends sessions (they are revalidated per request), revokes every PAT
/// and the pending set-password link. Fails for oneself, the last active Admin and the last Owner of a live project.
/// </summary>
public static class DeactivateUser
{
    public sealed record Command(Guid UserId);

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, AdminUserDto>
    {
        public async Task<AdminUserDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            await db.InTransactionAsync(ct => DeactivateAsync(command.UserId, ct), cancellationToken);
            return await AdminUsers.LoadAsync(db, command.UserId, clock.Now, cancellationToken);
        }

        private async Task<bool> DeactivateAsync(Guid userId, CancellationToken cancellationToken)
        {
            var user = await AdminUsers.FindTrackedAsync(db, userId, cancellationToken);
            if (!user.IsActive)
                return false;

            var now = clock.Now;
            user.Deactivate(currentUser.Id, now);
            if (user.GlobalRole == GlobalRole.Admin)
                await AdminUsers.EnsureAnotherActiveAdminAsync(db, user.Id, cancellationToken);
            await AdminUsers.EnsureNotLastProjectOwnerAsync(db, user.Id, cancellationToken);

            var tokens = await db.PersonalAccessTokens.Where(t => t.UserId == user.Id && t.RevokedAt == null).ToListAsync(cancellationToken);
            foreach (var token in tokens)
            {
                token.Revoke(currentUser.Id, now);
                activity.Record(ActivityEntityType.PersonalAccessToken, token.Id, null, "pat.revoked",
                    new { token.Name, token.Prefix, token.UserId, Reason = "userDeactivated" });
            }

            activity.Record(ActivityEntityType.User, user.Id, null, "user.deactivated", new { RevokedTokens = tokens.Count });
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
    }
}
