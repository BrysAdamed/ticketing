using Ticketing.Domain.Collaboration;

namespace Ticketing.Application.Collaboration;

/// <summary>A user newly mentioned by <see cref="Event"/>, if they can read its project.</summary>
public sealed record MentionCandidate(TicketEvent Event, Guid UserId);

/// <summary>
/// Who is newly mentioned (D-96): users mentioned in the description of a new ticket or in a new comment, and users that an
/// edit adds to a description or comment. Mentions already in the previous text do not count again, and the actor never
/// counts. A newly mentioned user starts watching and is notified with <c>Mentioned</c>.
/// </summary>
public static class MentionRules
{
    public static IReadOnlyList<MentionCandidate> Candidates(IEnumerable<CollaborationEvent> events) =>
        [.. events
            .OfType<TicketEvent>()
            .SelectMany(e => Mentioned(e).Where(id => id != e.ActorId).Select(id => new MentionCandidate(e, id)))];

    public static bool InComment(TicketEvent e) => e is CommentAdded or CommentEdited;

    private static IReadOnlyList<Guid> Mentioned(TicketEvent e) => e switch
    {
        TicketCreated created => Mentions.UserIds(created.Description),
        DescriptionChanged changed => Mentions.NewlyMentioned(changed.From, changed.To),
        CommentAdded added => Mentions.UserIds(added.Body),
        CommentEdited edited => Mentions.NewlyMentioned(edited.From, edited.To),
        _ => [],
    };
}
