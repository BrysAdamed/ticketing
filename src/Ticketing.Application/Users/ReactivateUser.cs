using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.Users;

/// <summary>Restores login. Revoked PATs stay revoked (spec 4.1).</summary>
public static class ReactivateUser
{
    public sealed record Command(Guid UserId);

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, AdminUserDto>
    {
        public async Task<AdminUserDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            var user = await AdminUsers.FindTrackedAsync(db, command.UserId, cancellationToken);
            if (!user.IsActive)
            {
                user.Reactivate();
                activity.Record(ActivityEntityType.User, user.Id, null, "user.reactivated");
                await db.SaveChangesAsync(cancellationToken);
            }
            return await AdminUsers.LoadAsync(db, user.Id, clock.Now, cancellationToken);
        }
    }
}
