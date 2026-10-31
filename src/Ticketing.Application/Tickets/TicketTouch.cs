using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;

namespace Ticketing.Application.Tickets;

/// <summary>
/// Bumps a ticket's <c>UpdatedAt</c> for a side-write that leaves the ticket's own fields alone (comments, links,
/// attachments). It skips the row-version check and never moves <c>UpdatedAt</c> back, so a parallel edit of the ticket
/// cannot fail the side-write (D-165). Call it after the side-write's <c>SaveChangesAsync</c>, inside the same transaction.
/// </summary>
public static class TicketTouch
{
    public static Task TouchTicketAsync(this ITicketingDbContext db, Guid ticketId, DateTimeOffset now, CancellationToken cancellationToken) =>
        db.Tickets
            .Where(t => t.Id == ticketId && t.UpdatedAt < now)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.UpdatedAt, now), cancellationToken);
}
