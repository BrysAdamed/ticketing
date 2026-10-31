using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;
using Ticketing.Domain.FeatureFlags;

namespace Ticketing.Application.FeatureFlags;

/// <summary>
/// Deletes a retired flag (one the code no longer declares, D-169); a declared flag is refused with <c>flag.notRetired</c>. The
/// audit entry keeps the last configuration.
/// </summary>
public static class DeleteFlag
{
    public sealed record Command(string Key);

    public sealed class Handler(
        ITicketingDbContext db, ICurrentUser currentUser, IActivityLog activity, IFeatureFlagStore store, IFeatureFlagCatalog catalog)
        : IHandler<Command, bool>
    {
        public async Task<bool> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            var flag = await FlagAdmin.FindTrackedAsync(db, command.Key, cancellationToken);
            if (catalog.Find(flag.Key) is not null)
                throw new AppException(ErrorKind.Conflict, FeatureFlagErrors.NotRetired, $"{flag.Key} is declared in code and cannot be deleted.",
                    "Only retired flags, which the code no longer reads, can be deleted. Reset the flag to its default instead.");
            db.FeatureFlags.Remove(flag);
            activity.Record(ActivityEntityType.FeatureFlag, flag.Id, null, "flag.deleted", FlagAdmin.Snapshot(flag));
            await db.SaveChangesAsync(cancellationToken);
            store.Invalidate();
            return true;
        }
    }
}
