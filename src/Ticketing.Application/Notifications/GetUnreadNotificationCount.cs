using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;

namespace Ticketing.Application.Notifications;

/// <summary>How many of the caller's notifications are unread (the bell badge); same access check as the list.</summary>
public static class GetUnreadNotificationCount
{
    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, UnreadNotificationCountDto>
    {
        public async Task<UnreadNotificationCountDto> HandleAsync(Query request, CancellationToken cancellationToken) =>
            new(await NotificationQueries.UnreadCountAsync(db, access, currentUser, cancellationToken));
    }
}
