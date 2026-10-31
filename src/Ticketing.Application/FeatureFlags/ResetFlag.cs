using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;
using Ticketing.Domain.FeatureFlags;

namespace Ticketing.Application.FeatureFlags;

/// <summary>
/// Restores the default declared in code and clears all targeting (D-168), with a <c>flag.reset</c> entry holding the
/// configuration before and after. A retired flag has no default and is refused with <c>flag.retired</c>.
/// </summary>
public static class ResetFlag
{
    public const string Action = "flag.reset";

    public sealed record Command(string Key, uint? ExpectedVersion = null);

    public sealed class Handler(
        ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IActivityLog activity, IFeatureFlagStore store, FeatureFlagSync sync,
        IFeatureFlagCatalog catalog) : IHandler<Command, FlagDto>
    {
        public async Task<FlagDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            await sync.EnsureAsync(cancellationToken);
            var flag = await FlagAdmin.FindTrackedAsync(db, command.Key, cancellationToken);
            db.ExpectVersion(flag, command.ExpectedVersion);
            var definition = catalog.Find(flag.Key)
                ?? throw new AppException(ErrorKind.Conflict, FeatureFlagErrors.Retired, $"{flag.Key} is retired and has no default.",
                    "The code no longer declares this flag; delete it instead.");

            var before = FlagAdmin.Snapshot(flag);
            flag.ResetToDefault(definition.DefaultOn, currentUser.Id, clock.Now);
            activity.RecordChange(ActivityEntityType.FeatureFlag, flag.Id, null, Action, "configuration", before, FlagAdmin.Snapshot(flag));

            await db.SaveChangesAsync(cancellationToken);
            store.Invalidate();
            return (await FlagAdmin.ToDtosAsync(db, catalog, [flag], cancellationToken))[0];
        }
    }
}
