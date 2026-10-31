using Ticketing.Domain.Common;

namespace Ticketing.Domain.Collaboration;

/// <summary>What a notification is about. Stored as an integer: never renumber or reuse a value.</summary>
public enum NotificationKind
{
    Assigned = 1,
    Mentioned = 2,
    Commented = 3,
    StatusChanged = 4,
    PriorityRaised = 5,
    Moved = 6,
    Deleted = 7,
    RegressionItemAssigned = 8,
    DocUpdated = 9,
}

/// <summary>
/// An in-app notification for one recipient (I-30, D-94) about a ticket, a regression item or a doc. Rapid changes by the same
/// actor on the same ticket, regression session or doc are merged into one row; the headline (kind and summary) is the highest ranked event. The summary is a short
/// server-rendered sentence without user content, so nothing a user removes later lingers here. New versions of a doc collapse
/// over the longer <see cref="PublishCollapseWindow"/> (D-173).
/// </summary>
public sealed class Notification
{
    public const int SummaryMaxLength = 300;
    public static readonly TimeSpan CollapseWindow = TimeSpan.FromMinutes(5);
    public static readonly TimeSpan PublishCollapseWindow = TimeSpan.FromHours(1);
    public static readonly TimeSpan Retention = TimeSpan.FromDays(90);

    private Notification()
    {
    }

    public Guid Id { get; private set; }

    public Guid RecipientId { get; private set; }

    public Guid ProjectId { get; private set; }

    public Guid? TicketId { get; private set; }

    public Guid? RegressionSessionId { get; private set; }

    public string? TestCaseKey { get; private set; }

    public Guid? DocNodeId { get; private set; }

    /// <summary>For <see cref="NotificationKind.DocUpdated"/>: the version the first merged publish created, so the link can show every change since.</summary>
    public int? DocVersion { get; private set; }

    public Guid? ActorId { get; private set; }

    public NotificationKind Kind { get; private set; }

    public string Summary { get; private set; } = string.Empty;

    public int EventCount { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset? ReadAt { get; private set; }

    public static Notification AboutTicket(Guid recipientId, Guid projectId, Guid ticketId, Guid? actorId, NotificationKind kind, string summary, DateTimeOffset now)
    {
        if (ticketId == Guid.Empty)
            throw new ArgumentException("A ticket notification needs a ticket.", nameof(ticketId));
        return Create(recipientId, projectId, actorId, kind, summary, now, n => n.TicketId = ticketId);
    }

    public static Notification AboutRegressionItem(
        Guid recipientId, Guid projectId, Guid sessionId, string testCaseKey, Guid? actorId, NotificationKind kind, string summary, DateTimeOffset now)
    {
        if (sessionId == Guid.Empty)
            throw new ArgumentException("A regression notification needs a session.", nameof(sessionId));
        ArgumentException.ThrowIfNullOrWhiteSpace(testCaseKey);
        return Create(recipientId, projectId, actorId, kind, summary, now, n =>
        {
            n.RegressionSessionId = sessionId;
            n.TestCaseKey = testCaseKey;
        });
    }

    /// <param name="docVersion">The version a <see cref="NotificationKind.DocUpdated"/> event published; null for other kinds.</param>
    public static Notification AboutDoc(
        Guid recipientId, Guid projectId, Guid docNodeId, Guid? actorId, NotificationKind kind, string summary, DateTimeOffset now, int? docVersion = null)
    {
        if (docNodeId == Guid.Empty)
            throw new ArgumentException("A doc notification needs a doc.", nameof(docNodeId));
        if (docVersion is < 1)
            throw new ArgumentOutOfRangeException(nameof(docVersion));
        return Create(recipientId, projectId, actorId, kind, summary, now, n =>
        {
            n.DocNodeId = docNodeId;
            n.DocVersion = docVersion;
        });
    }

    /// <summary>Headline rank: the kind shown when several events are merged into one notification (higher wins).</summary>
    public static int Rank(NotificationKind kind) => kind switch
    {
        NotificationKind.Mentioned => 9,
        NotificationKind.Assigned => 8,
        NotificationKind.RegressionItemAssigned => 7,
        NotificationKind.Deleted => 6,
        NotificationKind.StatusChanged => 5,
        NotificationKind.PriorityRaised => 4,
        NotificationKind.Commented => 3,
        NotificationKind.Moved => 2,
        NotificationKind.DocUpdated => 1,
        _ => 0,
    };

    /// <summary>
    /// Whether an event is merged into this notification: same recipient, actor and ticket (or regression session, or doc),
    /// still unread, and within <see cref="CollapseWindow"/> of the first event, so the row keeps its place in the list. A new
    /// version merges into a notification headed by new versions for <see cref="PublishCollapseWindow"/> instead (D-173).
    /// </summary>
    public bool Absorbs(
        Guid recipientId, Guid? actorId, Guid? ticketId, Guid? regressionSessionId, Guid? docNodeId, NotificationKind kind, DateTimeOffset at) =>
        ReadAt is null
        && RecipientId == recipientId
        && ActorId == actorId
        && TicketId == ticketId
        && RegressionSessionId == regressionSessionId
        && DocNodeId == docNodeId
        && at - CreatedAt <= (Kind == NotificationKind.DocUpdated && kind == NotificationKind.DocUpdated ? PublishCollapseWindow : CollapseWindow);

    public void Merge(NotificationKind kind, string summary, DateTimeOffset at)
    {
        EventCount++;
        if (at > UpdatedAt)
            UpdatedAt = at;
        if (Rank(kind) > Rank(Kind))
        {
            Kind = kind;
            Summary = Clip(summary);
        }
    }

    public void MarkRead(DateTimeOffset at) => ReadAt ??= at;

    private static Notification Create(
        Guid recipientId, Guid projectId, Guid? actorId, NotificationKind kind, string summary, DateTimeOffset now, Action<Notification> about)
    {
        if (recipientId == Guid.Empty)
            throw new ArgumentException("A notification needs a recipient.", nameof(recipientId));
        if (projectId == Guid.Empty)
            throw new ArgumentException("A notification needs a project.", nameof(projectId));
        if (!Enum.IsDefined(kind))
            throw new ArgumentOutOfRangeException(nameof(kind));
        ArgumentException.ThrowIfNullOrWhiteSpace(summary);
        var notification = new Notification
        {
            Id = EntityId.New(),
            RecipientId = recipientId,
            ProjectId = projectId,
            ActorId = actorId,
            Kind = kind,
            Summary = Clip(summary),
            EventCount = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        about(notification);
        return notification;
    }

    private static string Clip(string summary) =>
        summary.Length <= SummaryMaxLength ? summary : string.Concat(summary.AsSpan(0, SummaryMaxLength - 1), "…");
}
