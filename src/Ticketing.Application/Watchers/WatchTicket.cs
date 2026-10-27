using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;

namespace Ticketing.Application.Watchers;

/// <summary>
/// The caller starts watching a ticket (I-32, D-93). Reading the ticket is enough (viewers, archived projects); it changes only
/// the caller's own state, so it needs write-scoped credentials. Watching twice is a no-op.
/// </summary>
public static class WatchTicket
{
    public sealed record Command(string KeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock) : IHandler<Command, WatchersDto>
    {
        public async Task<WatchersDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.ReadAsync(db, access, command.KeyOrId, cancellationToken);
            currentUser.EnsureWriteScope();
            await db.Database.ExecuteSqlAsync(
                $"INSERT INTO ticket_watchers (ticket_id, user_id, created_at) VALUES ({target.Id}, {currentUser.Id}, {clock.Now}) ON CONFLICT DO NOTHING",
                cancellationToken);
            return await WatcherQueries.LoadAsync(db, currentUser, target, cancellationToken);
        }
    }
}
