namespace Ticketing.Application.Collaboration;

/// <summary>A user who should start watching a ticket, if they can read its project and do not watch it yet.</summary>
public sealed record WatchCandidate(Guid TicketId, Guid ProjectId, Guid UserId, DateTimeOffset At);

/// <summary>A user who should start watching a page or diagram, if they can read its project and do not watch it yet.</summary>
public sealed record DocWatchCandidate(Guid DocNodeId, Guid ProjectId, Guid UserId, DateTimeOffset At);

/// <summary>
/// Who starts watching automatically (I-32, D-162): the reporter and the assignee of a new ticket, each new assignee, whoever
/// comments and whoever is newly mentioned (D-96); the creator of a page or diagram, whoever publishes or restores a version of
/// it, whoever comments on it and whoever it newly mentions (D-162, D-163, D-178). Someone who unwatched is added again only by
/// a new trigger.
/// </summary>
public static class WatchingRules
{
    public static IReadOnlyList<WatchCandidate> Candidates(IEnumerable<CollaborationEvent> events, IEnumerable<MentionCandidate> mentions)
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
        foreach (var mention in mentions)
        {
            if (mention.Event is TicketEvent ticketEvent)
                Add(candidates, ticketEvent, mention.UserId);
        }
        return [.. candidates.DistinctBy(c => (c.TicketId, c.UserId))];
    }

    public static IReadOnlyList<DocWatchCandidate> DocCandidates(IEnumerable<CollaborationEvent> events, IEnumerable<MentionCandidate> mentions)
    {
        var actors = events
            .OfType<DocEvent>()
            .Where(e => e is DocCreated or DocPublished or DocRestored or DocCommentAdded && e.ActorId is not null)
            .Select(e => new DocWatchCandidate(e.DocNodeId, e.ProjectId, e.ActorId!.Value, e.OccurredAt));
        var mentioned = mentions
            .Where(m => m.Event is DocEvent)
            .Select(m => (Event: (DocEvent)m.Event, m.UserId))
            .Select(m => new DocWatchCandidate(m.Event.DocNodeId, m.Event.ProjectId, m.UserId, m.Event.OccurredAt));
        return [.. actors.Concat(mentioned).DistinctBy(c => (c.DocNodeId, c.UserId))];
    }

    private static void Add(List<WatchCandidate> candidates, TicketEvent e, Guid? userId)
    {
        if (userId is { } id)
            candidates.Add(new WatchCandidate(e.TicketId, e.ProjectId, id, e.OccurredAt));
    }
}
