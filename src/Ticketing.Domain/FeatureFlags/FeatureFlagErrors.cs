namespace Ticketing.Domain.FeatureFlags;

public static class FeatureFlagErrors
{
    public const string NotFound = "flag.notFound";
    public const string KeyInvalid = "flag.key.invalid";
    public const string NotRetired = "flag.notRetired";
    public const string Retired = "flag.retired";
    public const string RolloutRange = "flag.rollout.range";
    public const string TooManyTargetUsers = "flag.targetUsers.tooMany";
    public const string UnknownTargetUsers = "flag.targetUsers.unknown";
}
