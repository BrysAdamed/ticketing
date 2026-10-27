using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;

namespace Ticketing.Application.Notifications;

/// <summary>
/// Marks some (up to 100 ids) or all of the caller's notifications read and returns the new unread count. Ids of other users'
/// notifications, or unknown ids, are ignored, so the call reveals nothing about them. Already read ones keep their time.
/// </summary>
public static class MarkNotificationsRead
{
    public const int MaxIds = 100;

    /// <param name="Ids">The notifications to mark read, 1 to 100; or none with <paramref name="All"/>.</param>
    /// <param name="All">Mark every notification created up to now.</param>
    public sealed record Command(IReadOnlyList<Guid>? Ids = null, bool All = false) : IValidatable
    {
        public void Validate(Validator v)
        {
            var count = Ids?.Count ?? 0;
            v.Must(All ? count == 0 : count > 0, "ids", "Send either ids or all = true.");
            v.Must(count <= MaxIds, "ids", $"ids may name at most {MaxIds} notifications.");
        }
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock) : IHandler<Command, MarkNotificationsReadResult>
    {
        public async Task<MarkNotificationsReadResult> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureWriteScope();

            var me = currentUser.Id;
            var now = clock.Now;
            var unread = db.Notifications.Where(n => n.RecipientId == me && n.ReadAt == null);
            if (command.All)
                unread = unread.Where(n => n.CreatedAt <= now);
            else
            {
                var ids = command.Ids!.Distinct().ToList();
                unread = unread.Where(n => ids.Contains(n.Id));
            }
            await unread.ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, now), cancellationToken);
            return new MarkNotificationsReadResult(await NotificationQueries.UnreadCountAsync(db, access, currentUser, cancellationToken));
        }
    }
}
