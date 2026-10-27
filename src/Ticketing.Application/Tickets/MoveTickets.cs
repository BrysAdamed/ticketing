using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Boards;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

public enum RankPosition
{
    Top = 1,
    Bottom = 2,
}

/// <summary>
/// The single application path for every placement change (spec 6.4, 6.6, I-11, D-66): backlog reorder, backlog to board,
/// board to backlog, board to board and column changes. 1..100 tickets move as one block, keep the order sent and land
/// right before or after an anchor ticket, at the top or bottom of the target, or at the default position (bottom of the
/// board's status column, top of the backlog). A target status applies the ticket status rules (<see cref="Ticket.ChangeStatus"/>)
/// and writes field history; a container change writes <c>ticket.moved</c>. A pure reorder writes no history and keeps
/// <c>UpdatedAt</c> (D-48). An optional source guards stale views: every ticket must still be there. Serves REST
/// <c>POST /tickets/move</c> and MCP <c>move_ticket</c>.
/// </summary>
public static class MoveTickets
{
    public const int MaxTickets = 100;
    public const string BacklogTarget = "backlog";

    /// <param name="Keys">Ticket keys or ids, in the order they should end up in.</param>
    /// <param name="Target"><c>backlog</c> (each ticket goes to its own project backlog) or a board id.</param>
    /// <param name="Status">The target column; omitted keeps each ticket's status.</param>
    /// <param name="Position">Top or bottom of the target; an alternative to <paramref name="BeforeKey"/> and <paramref name="AfterKey"/>.</param>
    /// <param name="From"><c>backlog</c> or a board id the tickets are expected to be in; a mismatch is a conflict.</param>
    public sealed record Command(
        IReadOnlyList<string> Keys,
        string Target,
        TicketStatus? Status = null,
        string? BeforeKey = null,
        string? AfterKey = null,
        RankPosition? Position = null,
        string? From = null) : IValidatable
    {
        public void Validate(Validator validator)
        {
            var anchors = (BeforeKey is null ? 0 : 1) + (AfterKey is null ? 0 : 1) + (Position is null ? 0 : 1);
            validator
                .Must(Keys is { Count: > 0 and <= MaxTickets }, "keys", $"Send 1..{MaxTickets} ticket keys.")
                .Must(IsContainer(Target), "target", "target must be 'backlog' or a board id.")
                .Must(anchors <= 1, "position", "Send at most one of beforeKey, afterKey or position (Top or Bottom).")
                .Must(From is null || IsContainer(From), "from", "from must be 'backlog' or a board id.");
        }

        private static bool IsContainer(string? value) =>
            string.Equals(value?.Trim(), BacklogTarget, StringComparison.OrdinalIgnoreCase) || Guid.TryParse(value, out _);
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        IClock clock,
        IActivityLog activity,
        ITicketRanker ranker) : IHandler<Command, IReadOnlyList<TicketSummaryDto>>
    {
        public async Task<IReadOnlyList<TicketSummaryDto>> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var targets = new List<TicketTarget>(command.Keys.Count);
            foreach (var key in command.Keys)
                targets.Add(await TicketLookup.WriteAsync(db, access, key, cancellationToken));
            var ids = targets.Select(t => t.Id).ToList();
            if (ids.Distinct().Count() != ids.Count)
                throw AppException.Invalid("keys", "Each ticket may appear only once.");

            Guid? boardId = Guid.TryParse(command.Target, out var parsed) ? parsed : null;
            var anchor = await AnchorAsync(command, targets, boardId, cancellationToken);
            await db.InTransactionAsync(ct => MoveAsync(command, targets, boardId, anchor, ct), cancellationToken);
            return await TicketQueries.SummariesAsync(db, ids, cancellationToken);
        }

        private async Task<RankAnchor> AnchorAsync(Command command, IReadOnlyList<TicketTarget> targets, Guid? boardId, CancellationToken cancellationToken)
        {
            var anchorKey = command.BeforeKey ?? command.AfterKey;
            if (anchorKey is null)
            {
                return command.Position switch
                {
                    RankPosition.Top => RankAnchor.Top,
                    RankPosition.Bottom => RankAnchor.Bottom,
                    _ => boardId is null ? RankAnchor.Top : RankAnchor.Bottom,
                };
            }

            var field = command.BeforeKey is not null ? "beforeKey" : "afterKey";
            var anchor = await TicketLookup.ReadAsync(db, access, anchorKey, cancellationToken);
            if (targets.Any(t => t.Id == anchor.Id))
                throw AppException.Invalid(field, "A ticket cannot be placed next to itself.");
            if (boardId is null && targets.Any(t => t.ProjectId != anchor.ProjectId))
                throw AppException.Invalid(field, "In the backlog, tickets can only be placed next to a ticket of their own project.");
            return command.BeforeKey is not null ? RankAnchor.Before(anchor.Id) : RankAnchor.After(anchor.Id);
        }

        private async Task<bool> MoveAsync(
            Command command, IReadOnlyList<TicketTarget> targets, Guid? boardId, RankAnchor anchor, CancellationToken cancellationToken)
        {
            var ids = targets.Select(t => t.Id).ToList();
            var tickets = await db.Tickets.Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id, cancellationToken);
            var sourceBoards = tickets.Values.Where(t => t.BoardId is not null).Select(t => t.BoardId!.Value);
            await BoardAccess.LockAsync(db, boardId is { } b ? sourceBoards.Append(b) : sourceBoards, exclusive: false, cancellationToken);
            EnsureSource(command.From, targets, tickets);
            await EnsureBoardsAsync(targets, tickets, boardId, cancellationToken);

            var now = clock.Now;
            List<(RankContainer Container, List<Guid> Ids)> containers = boardId is { } board
                ? [(RankContainer.Board(board), ids)]
                : targets.GroupBy(t => t.ProjectId).OrderBy(g => g.Key)
                    .Select(g => (RankContainer.Backlog(g.Key), g.Select(t => t.Id).ToList())).ToList();
            foreach (var (container, containerIds) in containers)
            {
                var ranks = await ranker.PlaceManyAsync(container, anchor, containerIds.Count, containerIds, cancellationToken);
                for (var i = 0; i < containerIds.Count; i++)
                    Apply(tickets[containerIds[i]], boardId, ranks[i], command.Status, now);
            }

            await db.SaveChangesAsync(cancellationToken);
            return true;
        }

        private void Apply(Ticket ticket, Guid? boardId, string rank, TicketStatus? status, DateTimeOffset now)
        {
            var fromBoard = ticket.BoardId;
            if (boardId is { } board)
                ticket.PlaceOnBoard(board, rank);
            else
                ticket.MoveToBacklog(rank);
            var changed = fromBoard != ticket.BoardId;
            if (changed)
                BoardRelocation.RecordMove(activity, ticket, fromBoard);

            if (status is { } newStatus && newStatus != ticket.Status)
            {
                var oldStatus = ticket.Status;
                var oldResolution = ticket.Resolution;
                ticket.ChangeStatus(newStatus, null, now);
                activity.RecordChange(ActivityEntityType.Ticket, ticket.Id, ticket.ProjectId, UpdateTicket.FieldChanged, "status", oldStatus, ticket.Status);
                activity.RecordChange(ActivityEntityType.Ticket, ticket.Id, ticket.ProjectId, UpdateTicket.FieldChanged, "resolution", oldResolution, ticket.Resolution);
                changed = true;
            }

            if (changed)
                ticket.Touch(now);
        }

        private static void EnsureSource(string? from, IReadOnlyList<TicketTarget> targets, IReadOnlyDictionary<Guid, Ticket> tickets)
        {
            if (from is null)
                return;
            Guid? expected = Guid.TryParse(from, out var board) ? board : null;
            var moved = targets.FirstOrDefault(t => tickets[t.Id].BoardId != expected);
            if (moved is null)
                return;
            throw AppException.Conflict(
                TicketErrors.NotInSource,
                expected is null ? $"{moved.Key} is on a board, not in the backlog." : $"{moved.Key} is no longer on this board.",
                "Reload the list; the ticket was moved.");
        }

        /// <summary>Source boards must be active (archived boards are read-only); a target board must be active and link every ticket's project.</summary>
        private async Task EnsureBoardsAsync(
            IReadOnlyList<TicketTarget> targets, IReadOnlyDictionary<Guid, Ticket> tickets, Guid? boardId, CancellationToken cancellationToken)
        {
            var boardIds = tickets.Values.Where(t => t.BoardId is not null).Select(t => t.BoardId!.Value).ToHashSet();
            if (boardId is { } id)
                boardIds.Add(id);
            var boards = await db.Boards.AsNoTracking()
                .Where(b => boardIds.Contains(b.Id) && b.DeletedAt == null)
                .Select(b => new { b.Id, b.ArchivedAt, Projects = b.Projects.Select(p => p.ProjectId).ToList() })
                .ToDictionaryAsync(b => b.Id, cancellationToken);

            foreach (var target in targets)
            {
                if (tickets[target.Id].BoardId is { } source && boards.TryGetValue(source, out var from) && from.ArchivedAt is not null)
                    throw AppException.Conflict(
                        BoardErrors.Archived, $"{target.Key} is on an archived board, which is read-only.", "Unarchive the board first.");
            }

            if (boardId is not { } targetId)
                return;
            if (!boards.TryGetValue(targetId, out var board))
                throw BoardAccess.NotFound(targetId.ToString());
            if (board.ArchivedAt is not null)
                throw AppException.Conflict(BoardErrors.Archived, "The board is archived and read-only.", "Unarchive the board first.");
            var unlinked = targets.FirstOrDefault(t => !board.Projects.Contains(t.ProjectId));
            if (unlinked is not null)
                throw AppException.Conflict(
                    BoardErrors.ProjectNotLinked, $"The board does not link project {unlinked.Grant.ProjectKey}, so {unlinked.Key} cannot be placed on it.",
                    "Link the project to the board first.");
        }
    }
}
