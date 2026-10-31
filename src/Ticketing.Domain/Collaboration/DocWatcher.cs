namespace Ticketing.Domain.Collaboration;

/// <summary>
/// A user following a page or diagram (I-85, D-162). Rows are added explicitly (watch) or by the collaboration rules (creator,
/// commenter, newly mentioned user) and kept when the user loses access; readers decide who is shown and notified.
/// </summary>
public sealed class DocWatcher
{
    private DocWatcher()
    {
    }

    public Guid DocNodeId { get; private set; }

    public Guid UserId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public static DocWatcher Create(Guid docNodeId, Guid userId, DateTimeOffset now)
    {
        if (docNodeId == Guid.Empty)
            throw new ArgumentException("A watcher needs a doc.", nameof(docNodeId));
        if (userId == Guid.Empty)
            throw new ArgumentException("A watcher needs a user.", nameof(userId));
        return new DocWatcher { DocNodeId = docNodeId, UserId = userId, CreatedAt = now };
    }
}
