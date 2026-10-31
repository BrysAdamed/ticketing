using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Collaboration;

namespace Ticketing.Application.Notifications;

/// <param name="Muted">You get no notifications of this kind.</param>
/// <param name="Direct">Addressed to you personally (mentions, assignments): muting a project does not silence it.</param>
public sealed record NotificationKindPreferenceDto(NotificationKind Kind, bool Muted, bool Direct);

public sealed record MutedProjectDto(Guid Id, string Key, string Name);

/// <summary>The caller's notification preferences (D-160): every kind with whether it is muted, and the muted projects they can read.</summary>
/// <param name="UpdatedAt">When the preferences last changed; null while nothing was ever muted.</param>
public sealed record NotificationPreferencesDto(
    IReadOnlyList<NotificationKindPreferenceDto> Kinds,
    IReadOnlyList<MutedProjectDto> MutedProjects,
    DateTimeOffset? UpdatedAt);

internal static class NotificationPreferenceQueries
{
    /// <summary>
    /// Muted projects the caller can no longer read are left out (and kept, so they apply again when access returns), like
    /// notifications and watchers.
    /// </summary>
    public static async Task<NotificationPreferencesDto> ForAsync(
        ITicketingDbContext db, IProjectAccess access, Guid userId, CancellationToken cancellationToken)
    {
        var preferences = await db.NotificationPreferences.AsNoTracking().SingleOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        return await ToDtoAsync(preferences, access, cancellationToken);
    }

    public static async Task<NotificationPreferencesDto> ToDtoAsync(
        NotificationPreferences? preferences, IProjectAccess access, CancellationToken cancellationToken)
    {
        var mutedKinds = preferences?.MutedKinds ?? [];
        var kinds = Enum.GetValues<NotificationKind>()
            .Select(k => new NotificationKindPreferenceDto(k, mutedKinds.Contains(k), NotificationPreferences.IsDirect(k)))
            .ToList();

        var projectIds = preferences?.MutedProjectIds ?? [];
        var projects = projectIds.Count == 0
            ? []
            : await access.ReadableProjects()
                .AsNoTracking()
                .Where(p => projectIds.Contains(p.Id))
                .OrderBy(p => p.Key)
                .Select(p => new MutedProjectDto(p.Id, p.Key, p.Name))
                .ToListAsync(cancellationToken);
        return new NotificationPreferencesDto(kinds, projects, preferences?.UpdatedAt);
    }
}
