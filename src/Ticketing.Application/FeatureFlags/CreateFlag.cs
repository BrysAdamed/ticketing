using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Users;

namespace Ticketing.Application.FeatureFlags;

public static class CreateFlag
{
    private const string KeyUniqueIndex = "ix_feature_flags_key";

    public sealed record Command(
        string Key,
        string? Description = null,
        bool Enabled = false,
        int RolloutPercentage = 0,
        IReadOnlyList<Guid>? TargetUserIds = null,
        IReadOnlyList<GlobalRole>? TargetRoles = null) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Required("key", Key, FeatureFlag.KeyMaxLength)
            .MaxLength("description", Description, FeatureFlag.DescriptionMaxLength)
            .Range("rolloutPercentage", RolloutPercentage, 0, 100);
    }

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IActivityLog activity, IFeatureFlagStore store)
        : IHandler<Command, FlagDto>
    {
        public async Task<FlagDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureAdminWebSession();

            var now = clock.Now;
            var flag = FeatureFlag.Create(command.Key, command.Description, currentUser.Id, now);
            flag.Configure(command.Description, command.Enabled, command.RolloutPercentage, command.TargetUserIds ?? [], command.TargetRoles ?? [], currentUser.Id, now);
            await FlagAdmin.EnsureTargetUsersExistAsync(db, flag.TargetUserIds, cancellationToken);
            if (await db.FeatureFlags.AnyAsync(f => f.Key == flag.Key, cancellationToken))
                throw KeyTaken(flag.Key);

            db.FeatureFlags.Add(flag);
            activity.Record(ActivityEntityType.FeatureFlag, flag.Id, null, "flag.created", FlagAdmin.Snapshot(flag));
            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (ex.IsUniqueViolation(KeyUniqueIndex))
            {
                throw KeyTaken(flag.Key);
            }
            store.Invalidate();
            return (await FlagAdmin.ToDtosAsync(db, [flag], cancellationToken))[0];
        }

        private static AppException KeyTaken(string key) =>
            new(ErrorKind.Conflict, FeatureFlagErrors.KeyTaken, $"A flag with the key {key} already exists.",
                errors: new Dictionary<string, string[]> { ["key"] = ["This key is already in use."] });
    }
}
