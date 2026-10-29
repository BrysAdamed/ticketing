using System.Text.RegularExpressions;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Onboarding;

/// <summary>How a user finished a guide: worked through it or closed it early. Either way it is not shown again.</summary>
public enum GuideState
{
    Completed = 1,
    Dismissed = 2,
}

/// <summary>
/// The version of a guide (welcome, checklist, tour, hint, What's new entry) a user completed or dismissed (D-132).
/// Guide ids are authored in the web client; the server only checks their shape. A client shows a guide again when its
/// current version is higher than the stored one.
/// </summary>
public sealed partial class UserGuideState
{
    public const int GuideIdMaxLength = 100;
    public const int MaxVersion = 1_000_000;
    public const int MaxPerUser = 200;
    public const string WelcomeGuideId = "welcome";

    private UserGuideState()
    {
        GuideId = null!;
    }

    public Guid UserId { get; private set; }

    public string GuideId { get; private set; }

    public int Version { get; private set; }

    public GuideState State { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static UserGuideState Create(Guid userId, string guideId, int version, GuideState state, DateTimeOffset now)
    {
        if (userId == Guid.Empty)
            throw new ArgumentException("A guide state needs a user.", nameof(userId));
        EnsureValidGuideId(guideId);
        var entity = new UserGuideState { UserId = userId, GuideId = guideId };
        entity.Record(version, state, now);
        return entity;
    }

    /// <summary>Lower-case words of letters and digits joined by <c>-</c>, in dot-separated segments: <c>tour.backlog</c>, <c>whats-new.2026-11</c>.</summary>
    public static bool IsValidGuideId(string? guideId) =>
        guideId is { Length: > 0 and <= GuideIdMaxLength } && GuideIdPattern().IsMatch(guideId);

    public static void EnsureValidGuideId(string? guideId)
    {
        if (!IsValidGuideId(guideId))
            throw DomainException.Invalid("guideId", OnboardingErrors.GuideInvalid,
                $"A guide id is 1 to {GuideIdMaxLength} lower-case letters, digits and '-', in segments separated by '.'.",
                "For example 'welcome', 'tour.backlog' or 'whats-new.2026-11'.");
    }

    public void Record(int version, GuideState state, DateTimeOffset now)
    {
        if (version is < 1 or > MaxVersion)
            throw new ArgumentOutOfRangeException(nameof(version), version, $"A guide version is between 1 and {MaxVersion}.");
        if (!Enum.IsDefined(state))
            throw new ArgumentOutOfRangeException(nameof(state), state, "Unknown guide state.");
        Version = version;
        State = state;
        UpdatedAt = now;
    }

    [GeneratedRegex(@"^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\z", RegexOptions.CultureInvariant)]
    private static partial Regex GuideIdPattern();
}
