namespace Ticketing.Application.Collaboration;

/// <summary>A user who should start watching a ticket, if they can read its project and do not watch it yet.</summary>
public sealed record WatchCandidate(Guid TicketId, Guid ProjectId, Guid UserId, DateTimeOffset At);

/// <summary>A user who should start watching a page or diagram, if they can read its project and do not watch it yet.</summary>
public sealed record DocWatchCandidate(Guid DocNodeId, Guid ProjectId, Guid UserId, DateTimeOffset At);

/// <summary>
/// Who starts watching automatically (I-32, D-161): the reporter and the assignee of a new ticket, each new assignee, whoever
/// comments and whoever is newly mentioned (D-96); the creator of a page or diagram and whoever comments on it. Someone who
/// unwatched is added again only by a new trigger.
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
            Add(candidates, mention.Event, mention.UserId);
        return [.. candidates.DistinctBy(c => (c.TicketId, c.UserId))];
    }

    public static IReadOnlyList<DocWatchCandidate> DocCandidates(IEnumerable<CollaborationEvent> events) =>
        [.. events
            .OfType<DocEvent>()
            .Where(e => e is DocCreated or DocCommentAdded && e.ActorId is not null)
            .Select(e => new DocWatchCandidate(e.DocNodeId, e.ProjectId, e.ActorId!.Value, e.OccurredAt))
            .DistinctBy(c => (c.DocNodeId, c.UserId))];

    private static void Add(List<WatchCandidate> candidates, TicketEvent e, Guid? userId)
    {
        if (userId is { } id)
            candidates.Add(new WatchCandidate(e.TicketId, e.ProjectId, id, e.OccurredAt));
    }
}
