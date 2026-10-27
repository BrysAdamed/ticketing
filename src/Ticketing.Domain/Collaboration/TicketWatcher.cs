namespace Ticketing.Domain.Collaboration;

/// <summary>
/// A user following a ticket (I-32). Rows are added explicitly (watch) or by the collaboration rules (reporter, assignee,
/// commenter) and kept when the user loses access; readers decide who is shown and notified.
/// </summary>
public sealed class TicketWatcher
{
    private TicketWatcher()
    {
    }

    public Guid TicketId { get; private set; }

    public Guid UserId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public static TicketWatcher Create(Guid ticketId, Guid userId, DateTimeOffset now)
    {
        if (ticketId == Guid.Empty)
            throw new ArgumentException("A watcher needs a ticket.", nameof(ticketId));
        if (userId == Guid.Empty)
            throw new ArgumentException("A watcher needs a user.", nameof(userId));
        return new TicketWatcher { TicketId = ticketId, UserId = userId, CreatedAt = now };
    }
}
