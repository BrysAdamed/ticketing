using Ticketing.Application.Tickets;
using Ticketing.Domain.Collaboration;

namespace Ticketing.Application.Notifications;

/// <param name="Deleted">The ticket was deleted since; it is still named so the notification makes sense.</param>
public sealed record NotificationTicketDto(string Key, string Title, bool Deleted);

public sealed record NotificationRegressionDto(string SessionKey, string SessionName, string TestCaseKey);

/// <summary>One notification of the caller, newest first in lists (D-94).</summary>
/// <param name="Summary">What the actor did, to be shown after the actor's name ("commented").</param>
/// <param name="EventCount">How many events were merged into this notification (1 or more).</param>
/// <param name="Actor">Who acted; null for system changes.</param>
/// <param name="Ticket">The ticket, for ticket notifications.</param>
/// <param name="Regression">The session and test case, for regression item assignments.</param>
/// <param name="Url">Where the web app opens it: the ticket or the regression item.</param>
public sealed record NotificationDto(
    Guid Id,
    NotificationKind Kind,
    string Summary,
    int EventCount,
    UserRefDto? Actor,
    string ProjectKey,
    NotificationTicketDto? Ticket,
    NotificationRegressionDto? Regression,
    string Url,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? ReadAt);

public sealed record UnreadNotificationCountDto(int Count);

public sealed record MarkNotificationsReadResult(int UnreadCount);
