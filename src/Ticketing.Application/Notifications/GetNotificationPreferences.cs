using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;

namespace Ticketing.Application.Notifications;

/// <summary>The caller's notification preferences: muted kinds and muted projects (D-160).</summary>
public static class GetNotificationPreferences
{
    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, NotificationPreferencesDto>
    {
        public Task<NotificationPreferencesDto> HandleAsync(Query request, CancellationToken cancellationToken) =>
            NotificationPreferenceQueries.ForAsync(db, access, currentUser.Id, cancellationToken);
    }
}
