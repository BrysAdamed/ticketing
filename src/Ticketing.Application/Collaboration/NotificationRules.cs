using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Collaboration;

/// <summary>Someone who should be notified about <see cref="Event"/>, if they can read its project.</summary>
public sealed record NotificationCandidate(Guid RecipientId, CollaborationEvent Event, NotificationKind Kind);

/// <summary>
/// Who is notified about what (I-30, D-94): the new assignee of a ticket or regression item, and the watchers of a ticket
/// when it is commented, changes status, has its priority raised to High or Highest, moves between backlog and boards or
/// is deleted. The actor is never notified about their own action. TKT-8 adds mentions as another source of candidates.
/// </summary>
public static class NotificationRules
{
    /// <summary>Tickets whose watchers <see cref="Candidates"/> needs.</summary>
    public static IReadOnlyCollection<Guid> WatchedTickets(IEnumerable<CollaborationEvent> events) =>
        [.. events.Where(e => WatcherKind(e) is not null).Select(e => ((TicketEvent)e).TicketId).Distinct()];

    public static IReadOnlyList<NotificationCandidate> Candidates(IEnumerable<CollaborationEvent> events, ILookup<Guid, Guid> watchersByTicket)
    {
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

            if (WatcherKind(e) is { } kind)
            {
                foreach (var watcher in watchersByTicket[((TicketEvent)e).TicketId].Distinct())
                    Add(candidates, e, watcher, kind);
            }
        }
        return candidates;
    }

    /// <summary>A raise counts only when it lands on High or Highest, coming from a lower priority (or none).</summary>
    public static bool IsRaise(Priority? from, Priority? to) =>
        to is Priority.High or Priority.Highest && (from is null || to < from);

    private static NotificationKind? WatcherKind(CollaborationEvent e) => e switch
    {
        CommentAdded => NotificationKind.Commented,
        StatusChanged => NotificationKind.StatusChanged,
        PriorityChanged p when IsRaise(p.From, p.To) => NotificationKind.PriorityRaised,
        TicketMoved => NotificationKind.Moved,
        TicketDeleted => NotificationKind.Deleted,
        _ => null,
    };

    private static void Add(List<NotificationCandidate> candidates, CollaborationEvent e, Guid recipientId, NotificationKind kind)
    {
        if (recipientId != e.ActorId)
            candidates.Add(new NotificationCandidate(recipientId, e, kind));
    }
}
