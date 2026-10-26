using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Boards;

/// <summary>
/// Moves a board's tickets for board-level operations (archive carry-over, project unlink, board delete). These only change
/// placement, so they do not check write access per ticket (D-44); each moved ticket gets a <c>ticket.moved</c> entry.
/// Must run inside <c>InTransactionAsync</c>.
/// </summary>
internal static class BoardRelocation
{
    public static async Task<IReadOnlyList<BoardTicket>> TicketsAsync(
        ITicketingDbContext db, Guid boardId, Guid? projectId, CancellationToken cancellationToken)
    {
        var tickets = db.Tickets.AsNoTracking().Where(t => t.BoardId == boardId && t.DeletedAt == null);
        if (projectId is { } only)
            tickets = tickets.Where(t => t.ProjectId == only);
        return await tickets
            .OrderBy(t => t.Rank).ThenBy(t => t.Id)
            .Select(t => new BoardTicket(t.Id, t.ProjectId, t.Status))
            .ToListAsync(cancellationToken);
    }

    public static async Task ApplyAsync(
        ITicketingDbContext db,
        ITicketRanker ranker,
        IActivityLog activity,
        CarryOverPlan plan,
        Guid? targetBoardId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var ids = plan.ToBoard.Concat(plan.ToBacklogs.Values.SelectMany(v => v)).ToList();
        if (ids.Count == 0)
            return;

        var tickets = await db.Tickets.Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id, cancellationToken);
        foreach (var (projectId, backlogIds) in plan.ToBacklogs.OrderBy(b => b.Key))
        {
            var ranks = await ranker.PlaceManyAsync(RankContainer.Backlog(projectId), RankAnchor.Top, backlogIds.Count, backlogIds, cancellationToken);
            for (var i = 0; i < backlogIds.Count; i++)
                Move(activity, tickets[backlogIds[i]], null, ranks[i], now);
        }

        if (plan.ToBoard.Count > 0 && targetBoardId is { } target)
        {
            var ranks = await ranker.PlaceManyAsync(RankContainer.Board(target), RankAnchor.Bottom, plan.ToBoard.Count, plan.ToBoard, cancellationToken);
            for (var i = 0; i < plan.ToBoard.Count; i++)
                Move(activity, tickets[plan.ToBoard[i]], target, ranks[i], now);
        }
    }

    public static void RecordMove(IActivityLog activity, Ticket ticket, Guid? fromBoardId) =>
        activity.RecordChange(ActivityEntityType.Ticket, ticket.Id, ticket.ProjectId, "ticket.moved", "boardId", fromBoardId, ticket.BoardId);

    private static void Move(IActivityLog activity, Ticket ticket, Guid? boardId, string rank, DateTimeOffset now)
    {
        var from = ticket.BoardId;
        if (boardId is { } id)
            ticket.PlaceOnBoard(id, rank);
        else
            ticket.MoveToBacklog(rank);
        RecordMove(activity, ticket, from);
        ticket.Touch(now);
    }
}
