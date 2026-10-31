using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Users;

namespace Ticketing.Application.FeatureFlags;

/// <summary>
/// PATCH of a flag's targeting; the key and the description come from code (D-169). Each changed field writes a
/// <c>flag.updated</c> entry.
/// </summary>
public static class UpdateFlag
{
    public sealed record Command : IValidatable
    {
        [JsonIgnore]
        public string Key { get; init; } = string.Empty;

        public Optional<bool> Enabled { get; init; }

        public Optional<int> RolloutPercentage { get; init; }

        public Optional<IReadOnlyList<Guid>> TargetUserIds { get; init; }

        public Optional<IReadOnlyList<GlobalRole>> TargetRoles { get; init; }

        [JsonIgnore]
        public uint? ExpectedVersion { get; init; }

        public void Validate(Validator validator)
        {
            if (RolloutPercentage.HasValue)
                validator.Range("rolloutPercentage", RolloutPercentage.Value, 0, 100);
        }
    }

    public sealed class Handler(
        ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IActivityLog activity, IFeatureFlagStore store, FeatureFlagSync sync,
        IFeatureFlagCatalog catalog) : IHandler<Command, FlagDto>
    {
        private const string Action = "flag.updated";

        public async Task<FlagDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureAdminWebSession();
            await sync.EnsureAsync(cancellationToken);
            var flag = await FlagAdmin.FindTrackedAsync(db, command.Key, cancellationToken);
            db.ExpectVersion(flag, command.ExpectedVersion);

            var before = new { flag.Enabled, flag.RolloutPercentage, TargetUserIds = flag.TargetUserIds.ToList(), TargetRoles = flag.TargetRoles.ToList() };
            var targetUserIds = command.TargetUserIds.HasValue ? command.TargetUserIds.Value ?? [] : before.TargetUserIds;
            if (command.TargetUserIds.HasValue)
                await FlagAdmin.EnsureTargetUsersExistAsync(db, targetUserIds.Except(before.TargetUserIds).ToList(), cancellationToken);

            flag.Configure(
                command.Enabled.GetValueOrDefault(before.Enabled),
                command.RolloutPercentage.GetValueOrDefault(before.RolloutPercentage),
                targetUserIds,
                command.TargetRoles.HasValue ? command.TargetRoles.Value ?? [] : before.TargetRoles,
                currentUser.Id,
                clock.Now);

            activity.RecordChange(ActivityEntityType.FeatureFlag, flag.Id, null, Action, "enabled", before.Enabled, flag.Enabled);
            activity.RecordChange(ActivityEntityType.FeatureFlag, flag.Id, null, Action, "rolloutPercentage", before.RolloutPercentage, flag.RolloutPercentage);
            activity.RecordChange(ActivityEntityType.FeatureFlag, flag.Id, null, Action, "targetUserIds", before.TargetUserIds, flag.TargetUserIds);
            activity.RecordChange(ActivityEntityType.FeatureFlag, flag.Id, null, Action, "targetRoles", before.TargetRoles, flag.TargetRoles);

            await db.SaveChangesAsync(cancellationToken);
            store.Invalidate();
            return (await FlagAdmin.ToDtosAsync(db, catalog, [flag], cancellationToken))[0];
        }
    }
}
