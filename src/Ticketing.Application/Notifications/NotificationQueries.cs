using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Collaboration;

namespace Ticketing.Application.Notifications;

public static class NotificationQueries
{
    /// <summary>The caller's own notifications, before read access is checked.</summary>
    public static IQueryable<Notification> Own(ITicketingDbContext db, ICurrentUser currentUser)
    {
        var me = currentUser.Id;
        return db.Notifications.AsNoTracking().Where(n => n.RecipientId == me);
    }

    /// <summary>The caller's unread notifications about projects they can still read.</summary>
    public static Task<int> UnreadCountAsync(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, CancellationToken cancellationToken) =>
        Own(db, currentUser)
            .Where(n => n.ReadAt == null && access.ReadableProjects().Any(p => p.Id == n.ProjectId))
            .CountAsync(cancellationToken);
}
