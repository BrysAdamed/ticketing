using System.Text.RegularExpressions;
using Ticketing.Domain.Common;
using Ticketing.Domain.Users;

namespace Ticketing.Domain.FeatureFlags;

public sealed partial class FeatureFlag
{
    public const int KeyMaxLength = 64;
    public const int DescriptionMaxLength = 500;
    public const int MaxTargetUsers = 200;

    private FeatureFlag()
    {
        Key = null!;
        TargetUserIds = [];
        TargetRoles = [];
    }

    public Guid Id { get; private set; }

    public string Key { get; private set; }

    public string? Description { get; private set; }

    public bool Enabled { get; private set; }

    public int RolloutPercentage { get; private set; }

    public List<Guid> TargetUserIds { get; private set; }

    public List<GlobalRole> TargetRoles { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public Guid? UpdatedById { get; private set; }

    public uint RowVersion { get; private set; }

    public static FeatureFlag Create(string key, string? description, Guid? actorId, DateTimeOffset now)
    {
        var normalized = key?.Trim() ?? string.Empty;
        if (normalized.Length > KeyMaxLength || !KeyPattern().IsMatch(normalized))
            throw DomainException.Invalid("key", FeatureFlagErrors.KeyInvalid, "Flag keys are lower case words separated by '.' or '-', for example board.swimlanes.");

        return new FeatureFlag
        {
            Id = EntityId.New(),
            Key = normalized,
            Description = Text.Optional(description, "description", DescriptionMaxLength),
            TargetUserIds = [],
            TargetRoles = [],
            CreatedAt = now,
            UpdatedAt = now,
            UpdatedById = actorId,
        };
    }

    public void Configure(
        string? description, bool enabled, int rolloutPercentage, IEnumerable<Guid> targetUserIds, IEnumerable<GlobalRole> targetRoles,
        Guid? actorId, DateTimeOffset now)
    {
        if (rolloutPercentage is < 0 or > 100)
            throw DomainException.Invalid("rolloutPercentage", FeatureFlagErrors.RolloutRange, "Rollout percentage must be between 0 and 100.");
        var users = targetUserIds.Distinct().ToList();
        if (users.Count > MaxTargetUsers)
            throw DomainException.Invalid("targetUserIds", FeatureFlagErrors.TooManyTargetUsers, $"A flag can target at most {MaxTargetUsers} users.");

        Description = Text.Optional(description, "description", DescriptionMaxLength);
        Enabled = enabled;
        RolloutPercentage = rolloutPercentage;
        TargetUserIds = users;
        TargetRoles = [.. targetRoles.Distinct()];
        UpdatedAt = now;
        UpdatedById = actorId;
    }

    /// <summary>Evaluates the flag for a user (spec 6.13, first match wins).</summary>
    public string Evaluate(Guid userId, GlobalRole role)
    {
        if (!Enabled)
            return FlagVariants.Off;
        if (TargetUserIds.Contains(userId) || TargetRoles.Contains(role))
            return FlagVariants.On;
        return FlagBucket.Compute(Key, userId) < RolloutPercentage ? FlagVariants.On : FlagVariants.Off;
    }

    [GeneratedRegex("^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex KeyPattern();
}
