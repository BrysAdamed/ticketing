using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <summary>
/// Soft-deletes a ticket (Owner only, spec 6.2, D-33). Rejected while it has non-deleted children. The ticket leaves its
/// board, its links are removed and test cases pointing to it are unlinked; the key stays reserved. The <c>ticket.deleted</c>
/// entry records what was removed (<see cref="Removed"/>), so <see cref="RestoreTicket"/> can undo the deletion.
/// </summary>
public static class DeleteTicket
{
    public const string Action = "ticket.deleted";

    public sealed record Command(string KeyOrId);

    public sealed record Result(Guid Id, string Key, bool Deleted);

    /// <summary>The <c>ticket.deleted</c> payload. Only <see cref="Key"/> and <see cref="BoardId"/> are shown in the ticket history.</summary>
    internal sealed record Removed(string Key, Guid? BoardId, string? Rank, IReadOnlyList<RemovedLink>? Links, IReadOnlyList<Guid>? TestCaseIds);

    /// <param name="Direction">Outward when the deleted ticket was the link's source.</param>
    internal sealed record RemovedLink(Guid TicketId, TicketLinkType Type, LinkDirection Direction, DateTimeOffset CreatedAt, Guid CreatedById);

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
                    var links = await db.TicketLinks.AsNoTracking()
                        .Where(l => l.SourceTicketId == id || l.TargetTicketId == id)
                        .OrderBy(l => l.CreatedAt)
                        .Select(l => new RemovedLink(
                            l.SourceTicketId == id ? l.TargetTicketId : l.SourceTicketId,
                            l.Type,
                            l.SourceTicketId == id ? LinkDirection.Outward : LinkDirection.Inward,
                            l.CreatedAt,
                            l.CreatedById))
                        .ToListAsync(ct);
                    var testCaseIds = await db.TestCases.Where(c => c.TicketId == id).OrderBy(c => c.Number).Select(c => c.Id).ToListAsync(ct);

                    ticket.Delete(currentUser.Id, clock.Now);
                    await db.TicketLinks.Where(l => l.SourceTicketId == id || l.TargetTicketId == id).ExecuteDeleteAsync(ct);
                    await db.TestCases.Where(c => c.TicketId == id).ExecuteUpdateAsync(s => s.SetProperty(c => c.TicketId, (Guid?)null), ct);
                    activity.Record(ActivityEntityType.Ticket, id, target.ProjectId, Action, new Removed(target.Key, boardId, ticket.Rank, links, testCaseIds));
                    await db.SaveChangesAsync(ct);
                    return new Result(id, target.Key, true);
                },
                cancellationToken);
        }
    }
}
