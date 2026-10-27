using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Boards;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <summary>
/// Undoes a ticket deletion within <see cref="Ticket.RestoreWindow"/> (Owner only, like delete). Uses the <c>ticket.deleted</c>
/// entry (<see cref="DeleteTicket.Removed"/>): the parent is kept while it is alive and still allowed, removed links come back
/// when the other ticket is alive, unlinked test cases are relinked unless they were linked elsewhere meanwhile. The ticket
/// goes back to its board when that board is active and still links the project, otherwise to the backlog; it keeps its
/// rank when the slot is free, else it goes to the default position (board: bottom, backlog: top, spec 6.4).
/// Writes <c>ticket.restored</c>.
/// </summary>
public static class RestoreTicket
{
    public const string Action = "ticket.restored";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    public sealed record Command(string KeyOrId);

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        ITicketRanker ranker) : IHandler<Command, TicketDto>
    {
        public async Task<TicketDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.OwnerIncludingDeletedAsync(db, access, command.KeyOrId, cancellationToken);
            await db.InTransactionAsync(ct => RestoreAsync(target, ct), cancellationToken);
            return await GetTicket.Handler.LoadAsync(db, access, currentUser, target, TicketIncludes.All, cancellationToken);
        }

        private async Task<bool> RestoreAsync(TicketTarget target, CancellationToken cancellationToken)
        {
            var id = target.Id;
            var now = clock.Now;
            var ticket = await db.Tickets.FromSql($"SELECT *, xmin FROM tickets WHERE id = {id} FOR UPDATE").SingleAsync(cancellationToken);
            ticket.Restore(now);
            var removed = await RemovedAsync(id, cancellationToken);

            var parentCleared = await KeepOrClearParentAsync(ticket, cancellationToken);
            var boardId = await PlaceAsync(ticket, removed?.BoardId, removed?.Rank ?? ticket.Rank, cancellationToken);
            var links = await RelinkTicketsAsync(id, removed?.Links ?? [], cancellationToken);
            var testCases = await RelinkTestCasesAsync(ticket, removed?.TestCaseIds ?? [], cancellationToken);

            ticket.Touch(now);
            activity.Record(ActivityEntityType.Ticket, id, target.ProjectId, Action, new { key = target.Key, boardId, links, testCases, parentCleared });
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }

        private async Task<DeleteTicket.Removed?> RemovedAsync(Guid id, CancellationToken cancellationToken)
        {
            var json = await db.ActivityEntries.AsNoTracking()
                .Where(a => a.EntityType == ActivityEntityType.Ticket && a.EntityId == id && a.Action == DeleteTicket.Action)
                .OrderByDescending(a => a.OccurredAt).ThenByDescending(a => a.Id)
                .Select(a => a.NewValue)
                .FirstOrDefaultAsync(cancellationToken);
            return json is null ? null : JsonSerializer.Deserialize<DeleteTicket.Removed>(json, Json);
        }

        private async Task<bool> KeepOrClearParentAsync(Ticket ticket, CancellationToken cancellationToken)
        {
            if (ticket.ParentId is not { } parentId)
                return false;
            var parent = await db.Tickets.AsNoTracking().SingleOrDefaultAsync(t => t.Id == parentId && t.DeletedAt == null, cancellationToken);
            if (parent is not null)
            {
                var ancestors = await TicketTree.AncestorsAsync(db, parentId, cancellationToken);
                var height = await TicketTree.SubtreeHeightAsync(db, ticket.Id, cancellationToken);
                if (TicketHierarchy.ParentViolation(ticket, parent, ancestors, height) is null)
                    return false;
            }
            ticket.ClearParent();
            return true;
        }

        /// <summary>Returns the board the ticket was put back on, or null for the backlog.</summary>
        private async Task<Guid?> PlaceAsync(Ticket ticket, Guid? originalBoardId, string originalRank, CancellationToken cancellationToken)
        {
            Guid? boardId = null;
            if (originalBoardId is { } candidate)
            {
                await BoardAccess.LockAsync(db, [candidate], exclusive: false, cancellationToken);
                var projectId = ticket.ProjectId;
                var active = await db.Boards.AsNoTracking().AnyAsync(
                    b => b.Id == candidate && b.DeletedAt == null && b.ArchivedAt == null && b.Projects.Any(p => p.ProjectId == projectId),
                    cancellationToken);
                if (active)
                    boardId = candidate;
            }

            var container = boardId is { } board ? RankContainer.Board(board) : RankContainer.Backlog(ticket.ProjectId);
            var fallback = boardId is null ? RankAnchor.Top : RankAnchor.Bottom;
            var rank = boardId == originalBoardId
                ? await ranker.ReuseOrPlaceAsync(container, originalRank, fallback, [ticket.Id], cancellationToken)
                : (await ranker.PlaceManyAsync(container, fallback, 1, [ticket.Id], cancellationToken))[0];

            if (boardId is { } target)
                ticket.PlaceOnBoard(target, rank);
            else
                ticket.MoveToBacklog(rank);
            return boardId;
        }

        private async Task<int> RelinkTicketsAsync(Guid id, IReadOnlyList<DeleteTicket.RemovedLink> removed, CancellationToken cancellationToken)
        {
            if (removed.Count == 0)
                return 0;
            var otherIds = removed.Select(l => l.TicketId).Distinct().ToList();
            var alive = await db.Tickets.AsNoTracking()
                .Where(t => otherIds.Contains(t.Id) && t.DeletedAt == null && db.Projects.Any(p => p.Id == t.ProjectId && p.DeletedAt == null))
                .Select(t => t.Id)
                .ToListAsync(cancellationToken);
            var existing = (await db.TicketLinks.AsNoTracking()
                    .Where(l => l.SourceTicketId == id || l.TargetTicketId == id)
                    .Select(l => new { l.SourceTicketId, l.TargetTicketId, l.Type })
                    .ToListAsync(cancellationToken))
                .Select(l => (l.SourceTicketId, l.TargetTicketId, l.Type))
                .ToHashSet();

            var restored = 0;
            foreach (var link in removed.Where(l => alive.Contains(l.TicketId)))
            {
                var (source, target) = link.Direction == LinkDirection.Outward ? (id, link.TicketId) : (link.TicketId, id);
                var canonical = TicketLink.Canonical(source, target, link.Type);
                if (!existing.Add((canonical.Source, canonical.Target, link.Type)))
                    continue;
                db.TicketLinks.Add(TicketLink.Create(source, target, link.Type, link.CreatedById, link.CreatedAt));
                restored++;
            }
            return restored;
        }

        private async Task<int> RelinkTestCasesAsync(Ticket ticket, IReadOnlyList<Guid> testCaseIds, CancellationToken cancellationToken)
        {
            if (testCaseIds.Count == 0)
                return 0;
            var id = ticket.Id;
            var projectId = ticket.ProjectId;
            return await db.TestCases
                .Where(c => testCaseIds.Contains(c.Id) && c.ProjectId == projectId && c.TicketId == null)
                .ExecuteUpdateAsync(s => s.SetProperty(c => c.TicketId, (Guid?)id), cancellationToken);
        }
    }
}
