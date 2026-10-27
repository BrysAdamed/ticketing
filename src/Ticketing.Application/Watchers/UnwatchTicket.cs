using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;

namespace Ticketing.Application.Watchers;

/// <summary>
/// The caller stops watching a ticket (I-32). It holds until the next automatic trigger (a new assignment, a comment).
/// Unwatching a ticket one does not watch is a no-op.
/// </summary>
public static class UnwatchTicket
{
    public sealed record Command(string KeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Command, WatchersDto>
    {
        public async Task<WatchersDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.ReadAsync(db, access, command.KeyOrId, cancellationToken);
            currentUser.EnsureWriteScope();
            var (ticketId, me) = (target.Id, currentUser.Id);
            await db.TicketWatchers.Where(w => w.TicketId == ticketId && w.UserId == me).ExecuteDeleteAsync(cancellationToken);
            return await WatcherQueries.LoadAsync(db, currentUser, target, cancellationToken);
        }
    }
}
