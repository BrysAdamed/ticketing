using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Collaboration;

/// <summary>Someone who should be notified about <see cref="Event"/>, if they can read its project.</summary>
public sealed record NotificationCandidate(Guid RecipientId, CollaborationEvent Event, NotificationKind Kind);

/// <summary>
/// Who is notified about what (I-30, D-94, D-96): the new assignee of a ticket or regression item, newly mentioned users,
/// and the watchers of a ticket when it is commented, changes status, has its priority raised to High or Highest, moves
/// between backlog and boards or is deleted. A watcher mentioned in a new comment gets <c>Mentioned</c> instead of
/// <c>Commented</c> for it. A comment on a page or diagram notifies the doc's watchers with <c>Commented</c>
/// (D-162), or <c>Mentioned</c> those it newly mentions (D-163); a new published or restored version notifies them with
/// <c>DocUpdated</c> (D-173), or <c>Mentioned</c> those a published page newly mentions. The actor is never notified about their own action, and <see cref="Unmuted"/> applies each
/// recipient's muted kinds and projects.
/// </summary>
public static class NotificationRules
{
    /// <summary>Tickets whose watchers <see cref="Candidates"/> needs.</summary>
    public static IReadOnlyCollection<Guid> WatchedTickets(IEnumerable<CollaborationEvent> events) =>
        [.. events.Where(e => WatcherKind(e) is not null).Select(e => ((TicketEvent)e).TicketId).Distinct()];

    /// <summary>Docs whose watchers <see cref="Candidates"/> needs.</summary>
    public static IReadOnlyCollection<Guid> WatchedDocs(IEnumerable<CollaborationEvent> events) =>
        [.. events.OfType<DocEvent>().Where(e => DocWatcherKind(e) is not null).Select(e => e.DocNodeId).Distinct()];

    public static IReadOnlyList<NotificationCandidate> Candidates(
        IEnumerable<CollaborationEvent> events,
        ILookup<Guid, Guid> watchersByTicket,
        IReadOnlyList<MentionCandidate> mentions,
        ILookup<Guid, Guid> watchersByDoc)
    {
        var mentioned = mentions.ToLookup(m => m.Event, m => m.UserId);
        var candidates = new List<NotificationCandidate>();
        foreach (var e in events)
        {
            switch (e)
            {
                case TicketCreated { AssigneeId: { } assignee }:
                    Add(candidates, e, assignee, NotificationKind.Assigned);
                    break;
                case AssigneeChanged { To: { } assignee }:
                    Add(candidates, e, assignee, NotificationKind.Assigned);
                    break;
                case RegressionItemAssigned { To: { } assignee }:
                    Add(candidates, e, assignee, NotificationKind.RegressionItemAssigned);
                    break;
            }

            var mentionedHere = mentioned[e].ToHashSet();
            foreach (var userId in mentionedHere)
                Add(candidates, e, userId, NotificationKind.Mentioned);

            if (e is DocEvent doc && DocWatcherKind(doc) is { } docKind)
            {
                foreach (var watcher in watchersByDoc[doc.DocNodeId].Distinct().Where(w => !mentionedHere.Contains(w)))
                    Add(candidates, e, watcher, docKind);
            }

            if (WatcherKind(e) is { } kind)
            {
                foreach (var watcher in watchersByTicket[((TicketEvent)e).TicketId].Distinct().Where(w => !mentionedHere.Contains(w)))
                    Add(candidates, e, watcher, kind);
            }
        }
        return candidates;
    }

    /// <summary>Drops the candidates their recipient's preferences silence (D-160); recipients without preferences keep all of theirs.</summary>
    public static IReadOnlyList<NotificationCandidate> Unmuted(
        IReadOnlyList<NotificationCandidate> candidates,
        IReadOnlyDictionary<Guid, NotificationPreferences> preferencesByUser) =>
        [.. candidates.Where(c => !preferencesByUser.TryGetValue(c.RecipientId, out var preferences)
            || !preferences.Silences(c.Kind, c.Event.ProjectId))];

    /// <summary>A raise counts only when it lands on High or Highest, coming from a lower priority (or none).</summary>
    public static bool IsRaise(Priority? from, Priority? to) =>
        to is Priority.High or Priority.Highest && (from is null || to < from);

    /// <summary>The version a published or restored doc event created; null for other events.</summary>
    public static int? PublishedVersion(CollaborationEvent e) => e switch
    {
        DocPublished published => published.Version,
        DocRestored restored => restored.Version,
        _ => null,
    };

    private static NotificationKind? WatcherKind(CollaborationEvent e) => e switch
    {
        CommentAdded => NotificationKind.Commented,
        StatusChanged => NotificationKind.StatusChanged,
        PriorityChanged p when IsRaise(p.From, p.To) => NotificationKind.PriorityRaised,
        TicketMoved => NotificationKind.Moved,
        TicketDeleted => NotificationKind.Deleted,
        _ => null,
    };

    private static NotificationKind? DocWatcherKind(CollaborationEvent e) => e switch
    {
        DocCommentAdded => NotificationKind.Commented,
        DocPublished or DocRestored => NotificationKind.DocUpdated,
        _ => null,
    };

    private static void Add(List<NotificationCandidate> candidates, CollaborationEvent e, Guid recipientId, NotificationKind kind)
    {
        if (recipientId != e.ActorId)
            candidates.Add(new NotificationCandidate(recipientId, e, kind));
    }
}
