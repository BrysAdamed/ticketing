using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;

namespace Ticketing.Application.Watchers;

/// <param name="Count">Number of <paramref name="Users"/>.</param>
/// <param name="Watching">Whether the caller watches the ticket.</param>
/// <param name="Users">Watchers who are active and can still read the project, by display name.</param>
public sealed record WatchersDto(int Count, bool Watching, IReadOnlyList<UserRefDto> Users);

public static class WatcherQueries
{
    /// <summary>The ticket's visible watchers; the caller must be able to read <paramref name="target"/>.</summary>
    public static async Task<WatchersDto> LoadAsync(ITicketingDbContext db, ICurrentUser currentUser, TicketTarget target, CancellationToken cancellationToken)
    {
        var ticketId = target.Id;
        var users = await (
                from w in db.TicketWatchers.AsNoTracking()
                where w.TicketId == ticketId
                join u in ProjectReaders.Of(db, target.ProjectId) on w.UserId equals u.Id
                orderby u.DisplayName, u.Id
                select new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive))
            .ToListAsync(cancellationToken);
        var me = currentUser.Id;
        return new WatchersDto(users.Count, users.Exists(u => u.Id == me), users);
    }
}
