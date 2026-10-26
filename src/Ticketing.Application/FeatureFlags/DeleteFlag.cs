using Ticketing.Application.Abstractions;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.FeatureFlags;

/// <summary>Deletes a flag; it then evaluates <c>off</c> for everyone. The audit entry keeps the last configuration.</summary>
public static class DeleteFlag
{
    public sealed record Command(string Key);

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IActivityLog activity, IFeatureFlagStore store) : IHandler<Command, bool>
    {
        public async Task<bool> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            var flag = await FlagAdmin.FindTrackedAsync(db, command.Key, cancellationToken);
            db.FeatureFlags.Remove(flag);
            activity.Record(ActivityEntityType.FeatureFlag, flag.Id, null, "flag.deleted", FlagAdmin.Snapshot(flag));
            await db.SaveChangesAsync(cancellationToken);
            store.Invalidate();
            return true;
        }
    }
}
