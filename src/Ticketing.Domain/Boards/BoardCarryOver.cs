using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Boards;

public sealed record BoardTicket(Guid Id, Guid ProjectId, TicketStatus Status);

/// <param name="Stay">Done tickets that stay on the archived board as a record.</param>
/// <param name="ToBoard">Tickets for the target board's bottom, in their current board order.</param>
/// <param name="ToBacklogs">Tickets per project for that project's backlog top, in their current board order.</param>
public sealed record CarryOverPlan(
    IReadOnlyList<Guid> Stay,
    IReadOnlyList<Guid> ToBoard,
    IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> ToBacklogs)
{
    public int ToBacklogCount => ToBacklogs.Values.Sum(ids => ids.Count);
}

/// <summary>Where a board's tickets go when it is archived, deleted or a project is unlinked (spec 6.4, I-11). Relative order is kept.</summary>
public static class BoardCarryOver
{
    /// <summary>
    /// Archive: Done tickets stay; the others go to <paramref name="target"/> when it links their project, otherwise to
    /// their project backlog.
    /// </summary>
    public static CarryOverPlan Plan(IEnumerable<BoardTicket> ticketsInRankOrder, Board? target)
    {
        var stay = new List<Guid>();
        var toBoard = new List<Guid>();
        var toBacklogs = new Dictionary<Guid, List<Guid>>();
        foreach (var ticket in ticketsInRankOrder)
        {
            if (ticket.Status == TicketStatus.Done)
                stay.Add(ticket.Id);
            else if (target is not null && target.Links(ticket.ProjectId))
                toBoard.Add(ticket.Id);
            else
                AddToBacklog(toBacklogs, ticket);
        }
        return new CarryOverPlan(stay, toBoard, Freeze(toBacklogs));
    }

    /// <summary>Board delete or project unlink: every ticket, Done included, goes back to its project backlog.</summary>
    public static CarryOverPlan Evacuate(IEnumerable<BoardTicket> ticketsInRankOrder)
    {
        var toBacklogs = new Dictionary<Guid, List<Guid>>();
        foreach (var ticket in ticketsInRankOrder)
            AddToBacklog(toBacklogs, ticket);
        return new CarryOverPlan([], [], Freeze(toBacklogs));
    }

    private static void AddToBacklog(Dictionary<Guid, List<Guid>> backlogs, BoardTicket ticket)
    {
        if (!backlogs.TryGetValue(ticket.ProjectId, out var ids))
            backlogs[ticket.ProjectId] = ids = [];
        ids.Add(ticket.Id);
    }

    private static Dictionary<Guid, IReadOnlyList<Guid>> Freeze(Dictionary<Guid, List<Guid>> backlogs) =>
        backlogs.ToDictionary(b => b.Key, b => (IReadOnlyList<Guid>)b.Value);
}
