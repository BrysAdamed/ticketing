using Ticketing.Domain.Collaboration;

namespace Ticketing.Application.Collaboration;

/// <summary>A user newly mentioned by <see cref="Event"/> (a <see cref="TicketEvent"/> or a <see cref="DocEvent"/>), if they can read its project.</summary>
public sealed record MentionCandidate(CollaborationEvent Event, Guid UserId);

/// <summary>
/// Who is newly mentioned (D-96, D-163, D-166): users mentioned in the description of a new ticket, in a new ticket or doc
/// comment or a new page, and users that an edit adds to a description, a comment or a published page. Mentions already in the previous text do not count again, and the
/// actor never counts. A newly mentioned user starts watching and is notified with <c>Mentioned</c>.
/// </summary>
public static class MentionRules
{
    public static IReadOnlyList<MentionCandidate> Candidates(IEnumerable<CollaborationEvent> events) =>
        [.. events.SelectMany(e => Mentioned(e).Where(id => id != e.ActorId).Select(id => new MentionCandidate(e, id)))];

    public static bool OnPage(CollaborationEvent e) => e is DocCreated or DocPublished;

    public static bool InComment(CollaborationEvent e) => e is CommentAdded or CommentEdited or DocCommentAdded or DocCommentEdited;

    private static IReadOnlyList<Guid> Mentioned(CollaborationEvent e) => e switch
    {
        TicketCreated created => Mentions.UserIds(created.Description),
        DescriptionChanged changed => Mentions.NewlyMentioned(changed.From, changed.To),
        CommentAdded added => Mentions.UserIds(added.Body),
        CommentEdited edited => Mentions.NewlyMentioned(edited.From, edited.To),
        DocCommentAdded added => Mentions.UserIds(added.Body),
        DocCommentEdited edited => Mentions.NewlyMentioned(edited.From, edited.To),
        DocCreated created => Mentions.UserIds(created.Content),
        DocPublished published => Mentions.NewlyMentioned(published.From, published.To),
        _ => [],
    };
}
