using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <summary>
/// Soft-deletes a ticket (Owner only, spec 6.2, D-33). Rejected while it has non-deleted children. The ticket leaves its
/// board, its links are removed and test cases pointing to it are unlinked; the key stays reserved.
/// </summary>
public static class DeleteTicket
{
    public sealed record Command(string KeyOrId);

    public sealed record Result(Guid Id, string Key, bool Deleted);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, Result>
    {
        public async Task<Result> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.OwnerAsync(db, access, command.KeyOrId, cancellationToken);
            return await db.InTransactionAsync(
                async ct =>
                {
                    var id = target.Id;
                    var children = await db.Tickets
                        .Where(t => t.ParentId == id && t.DeletedAt == null)
                        .OrderBy(t => t.Number)
                        .Select(t => t.Number)
                        .ToListAsync(ct);
                    if (children.Count > 0)
                        throw DomainException.Conflict(
                            TicketErrors.HasChildren,
                            $"{target.Key} has {children.Count} child ticket(s): {string.Join(", ", children.Take(5).Select(n => HumanKeys.Ticket(target.Grant.ProjectKey, n)))}.",
                            "Reparent or delete the child tickets first.");

                    var ticket = await db.Tickets.SingleAsync(t => t.Id == id, ct);
                    var boardId = ticket.BoardId;
                    ticket.Delete(currentUser.Id, clock.Now);
                    await db.TicketLinks.Where(l => l.SourceTicketId == id || l.TargetTicketId == id).ExecuteDeleteAsync(ct);
                    await db.TestCases.Where(c => c.TicketId == id).ExecuteUpdateAsync(s => s.SetProperty(c => c.TicketId, (Guid?)null), ct);
                    activity.Record(ActivityEntityType.Ticket, id, target.ProjectId, "ticket.deleted", new { key = target.Key, boardId });
                    await db.SaveChangesAsync(ct);
                    return new Result(id, target.Key, true);
                },
                cancellationToken);
        }
    }
}
