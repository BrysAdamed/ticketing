namespace Ticketing.Application.Collaboration;

/// <summary>A user who should start watching a ticket, if they can read its project and do not watch it yet.</summary>
public sealed record WatchCandidate(Guid TicketId, Guid ProjectId, Guid UserId, DateTimeOffset At);

/// <summary>
/// Who starts watching automatically (I-32): the reporter and the assignee of a new ticket, each new assignee, and whoever
/// comments. Someone who unwatched is added again only by a new trigger.
/// </summary>
public static class WatchingRules
{
    public static IReadOnlyList<WatchCandidate> Candidates(IEnumerable<CollaborationEvent> events)
    {
        var candidates = new List<WatchCandidate>();
        foreach (var e in events)
        {
            switch (e)
            {
                case TicketCreated created:
                    Add(candidates, created, created.ReporterId);
                    Add(candidates, created, created.AssigneeId);
                    break;
                case AssigneeChanged assigned:
                    Add(candidates, assigned, assigned.To);
                    break;
                case CommentAdded commented:
                    Add(candidates, commented, commented.ActorId);
                    break;
            }
        }
        return [.. candidates.DistinctBy(c => (c.TicketId, c.UserId))];
    }

    private static void Add(List<WatchCandidate> candidates, TicketEvent e, Guid? userId)
    {
        if (userId is { } id)
            candidates.Add(new WatchCandidate(e.TicketId, e.ProjectId, id, e.OccurredAt));
    }
}
