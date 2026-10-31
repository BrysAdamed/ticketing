using Ticketing.Domain.Common;

namespace Ticketing.Domain.Collaboration;

/// <summary>
/// The notification kinds and projects a user muted (TKT-36, D-160). Nothing is muted by default, and a user without a row
/// gets every notification. A muted kind is silenced everywhere; a muted project silences the activity of others there
/// (comments, status, priority, moves, deletion), while notifications addressed to the user personally (mentions and
/// assignments, see <see cref="IsDirect"/>) still come through unless their kind is muted itself.
/// </summary>
public sealed class NotificationPreferences
{
    public const int MaxMutedProjects = 200;

    private NotificationPreferences()
    {
        MutedKinds = [];
        MutedProjectIds = [];
    }

    public Guid UserId { get; private set; }

    public List<NotificationKind> MutedKinds { get; private set; }

    public List<Guid> MutedProjectIds { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static NotificationPreferences Create(Guid userId, DateTimeOffset now)
    {
        if (userId == Guid.Empty)
            throw new ArgumentException("Notification preferences need a user.", nameof(userId));
        return new NotificationPreferences { UserId = userId, UpdatedAt = now };
    }

    /// <summary>Mentions and assignments name the user personally, so muting a project does not silence them.</summary>
    public static bool IsDirect(NotificationKind kind) =>
        kind is NotificationKind.Mentioned or NotificationKind.Assigned or NotificationKind.RegressionItemAssigned;

    public bool Silences(NotificationKind kind, Guid projectId) =>
        MutedKinds.Contains(kind) || (!IsDirect(kind) && MutedProjectIds.Contains(projectId));

    /// <summary>Applies one change set; muting what is already muted, or unmuting what is not, changes nothing.</summary>
    public void Change(
        IEnumerable<NotificationKind> muteKinds,
        IEnumerable<NotificationKind> unmuteKinds,
        IEnumerable<Guid> muteProjectIds,
        IEnumerable<Guid> unmuteProjectIds,
        DateTimeOffset now)
    {
        var kinds = MutedKinds.Except(unmuteKinds).Union(muteKinds).ToList();
        if (kinds.Any(k => !Enum.IsDefined(k)))
            throw new ArgumentOutOfRangeException(nameof(muteKinds), "Unknown notification kind.");
        var projects = MutedProjectIds.Except(unmuteProjectIds).Union(muteProjectIds).ToList();
        if (projects.Count > MaxMutedProjects)
            throw DomainException.Conflict(CollaborationErrors.MutedProjectLimit,
                $"You can mute at most {MaxMutedProjects} projects.",
                "Unmute a project you no longer need muted first.");

        MutedKinds = [.. kinds.Order()];
        MutedProjectIds = projects;
        UpdatedAt = now;
    }
}
