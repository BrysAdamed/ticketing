using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Collaboration;

namespace Ticketing.Application.Notifications;

/// <summary>
/// Mutes or unmutes notification kinds and projects of the caller (D-160) and returns the preferences afterwards. Changes are
/// sets, so repeating a call or sending two at once never loses one. Projects are named by key or id and must be readable
/// (404 otherwise, like everywhere else); at most 200 projects can be muted.
/// </summary>
public static class UpdateNotificationPreferences
{
    public const int MaxProjectsPerCall = 50;

    /// <param name="MuteKinds">Kinds to stop notifying you about.</param>
    /// <param name="UnmuteKinds">Kinds to notify you about again.</param>
    /// <param name="MuteProjects">Project keys or ids whose activity should stop notifying you (mentions and assignments still do).</param>
    /// <param name="UnmuteProjects">Project keys or ids to notify you about again.</param>
    public sealed record Command(
        IReadOnlyList<NotificationKind>? MuteKinds = null,
        IReadOnlyList<NotificationKind>? UnmuteKinds = null,
        IReadOnlyList<string>? MuteProjects = null,
        IReadOnlyList<string>? UnmuteProjects = null) : IValidatable
    {
        public void Validate(Validator v)
        {
            var mute = MuteKinds ?? [];
            var unmute = UnmuteKinds ?? [];
            v.Must(mute.All(Enum.IsDefined), "muteKinds", "muteKinds holds an unknown kind.");
            v.Must(unmute.All(Enum.IsDefined), "unmuteKinds", "unmuteKinds holds an unknown kind.");
            v.Must(!mute.Intersect(unmute).Any(), "unmuteKinds", "A kind cannot be muted and unmuted in the same call.");

            var muteProjects = MuteProjects ?? [];
            var unmuteProjects = UnmuteProjects ?? [];
            v.Must(muteProjects.Count <= MaxProjectsPerCall, "muteProjects", $"muteProjects may name at most {MaxProjectsPerCall} projects.");
            v.Must(unmuteProjects.Count <= MaxProjectsPerCall, "unmuteProjects", $"unmuteProjects may name at most {MaxProjectsPerCall} projects.");
            v.Must(muteProjects.All(p => !string.IsNullOrWhiteSpace(p)), "muteProjects", "Project references cannot be empty.");
            v.Must(unmuteProjects.All(p => !string.IsNullOrWhiteSpace(p)), "unmuteProjects", "Project references cannot be empty.");
        }
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock) : IHandler<Command, NotificationPreferencesDto>
    {
        public async Task<NotificationPreferencesDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureWriteScope();

            var mute = await ResolveAsync(command.MuteProjects, cancellationToken);
            var unmute = await ResolveAsync(command.UnmuteProjects, cancellationToken);
            if (mute.Intersect(unmute).Any())
                throw AppException.Invalid("unmuteProjects", "A project cannot be muted and unmuted in the same call.");

            return await db.InTransactionAsync(ct => ChangeAsync(command, mute, unmute, ct), cancellationToken);
        }

        private async Task<List<Guid>> ResolveAsync(IReadOnlyList<string>? references, CancellationToken cancellationToken)
        {
            var ids = new List<Guid>();
            foreach (var reference in (references ?? []).Select(r => r.Trim()).Distinct(StringComparer.OrdinalIgnoreCase))
                ids.Add((await access.EnsureCanReadAsync(reference, cancellationToken)).ProjectId);
            return [.. ids.Distinct()];
        }

        private async Task<NotificationPreferencesDto> ChangeAsync(Command command, List<Guid> mute, List<Guid> unmute, CancellationToken cancellationToken)
        {
            var me = currentUser.Id;
            await db.Database.ExecuteSqlAsync($"SELECT 1 FROM users WHERE id = {me} FOR UPDATE", cancellationToken);

            var preferences = await db.NotificationPreferences.SingleOrDefaultAsync(p => p.UserId == me, cancellationToken);
            if (preferences is null)
            {
                preferences = NotificationPreferences.Create(me, clock.Now);
                db.NotificationPreferences.Add(preferences);
            }
            preferences.Change(command.MuteKinds ?? [], command.UnmuteKinds ?? [], mute, unmute, clock.Now);
            await db.SaveChangesAsync(cancellationToken);
            return await NotificationPreferenceQueries.ToDtoAsync(preferences, access, cancellationToken);
        }
    }
}
