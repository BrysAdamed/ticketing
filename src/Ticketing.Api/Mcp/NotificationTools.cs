using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.Notifications;
using Ticketing.Domain.Collaboration;

namespace Ticketing.Api.Mcp;

/// <summary>Your in-app notifications (I-30, D-94).</summary>
[McpServerToolType]
public sealed class NotificationTools
{
    [McpServerTool(Name = "list_notifications", ReadOnly = true, Idempotent = true, Title = "List notifications")]
    [Description("Lists your notifications, newest first: { items, nextCursor }. Each item has id, kind (Assigned, Mentioned, Commented, "
        + "StatusChanged, PriorityRaised, Moved, Deleted, RegressionItemAssigned), summary (what the actor did), eventCount (changes merged "
        + "into it), actor, projectKey, ticket { key, title, deleted }, regression { sessionKey, sessionName, testCaseKey } "
        + "or doc { key, title, deleted } (comments on a page or diagram), url, "
        + "createdAt, updatedAt and readAt (null while unread).")]
    public static Task<CursorPage<NotificationDto>> ListNotifications(
        ListNotifications.Handler handler,
        [Description("Only unread notifications. Default false.")] bool? unreadOnly = null,
        [Description("nextCursor from the previous page (same unreadOnly).")] string? cursor = null,
        [Description("Page size 1..100, default 25.")] int? limit = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new ListNotifications.Query(unreadOnly ?? false, new PageRequest(limit, cursor)), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "mark_notifications_read", Destructive = false, Idempotent = true, Title = "Mark notifications read")]
    [Description("Marks your notifications read: pass ids (1 to 100, from list_notifications) or all = true, not both. "
        + "Returns { unreadCount }.")]
    public static Task<MarkNotificationsReadResult> MarkNotificationsRead(
        MarkNotificationsRead.Handler handler,
        [Description("Notification ids to mark read.")] Guid[]? ids = null,
        [Description("Mark every notification read.")] bool? all = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new MarkNotificationsRead.Command(ids, all ?? false), cancellationToken);

    private const string PreferencesShape = "Returns { kinds: [{ kind, muted, direct }], mutedProjects: [{ id, key, name }], updatedAt }; "
        + "direct kinds (Assigned, Mentioned, RegressionItemAssigned) are addressed to you and still notify in muted projects.";

    [McpServerTool(Name = "get_notification_preferences", ReadOnly = true, Idempotent = true, Title = "Get notification preferences")]
    [Description("Your notification preferences: which kinds and projects you muted. " + PreferencesShape)]
    public static Task<NotificationPreferencesDto> GetNotificationPreferences(
        GetNotificationPreferences.Handler handler,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetNotificationPreferences.Query(), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "update_notification_preferences", Destructive = false, Idempotent = true, Title = "Update notification preferences")]
    [Description("Mutes or unmutes notification kinds and projects for you. Kinds: Assigned, Mentioned, Commented, StatusChanged, "
        + "PriorityRaised, Moved, Deleted, RegressionItemAssigned. A muted kind never notifies; a muted project stops the other kinds "
        + "there. Omitted lists change nothing. " + PreferencesShape)]
    public static Task<NotificationPreferencesDto> UpdateNotificationPreferences(
        UpdateNotificationPreferences.Handler handler,
        [Description("Kinds to mute.")] NotificationKind[]? muteKinds = null,
        [Description("Kinds to unmute.")] NotificationKind[]? unmuteKinds = null,
        [Description("Project keys or ids to mute (1..50), for example [\"WEB\"].")] string[]? muteProjects = null,
        [Description("Project keys or ids to unmute (1..50).")] string[]? unmuteProjects = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new UpdateNotificationPreferences.Command(muteKinds, unmuteKinds, muteProjects, unmuteProjects), cancellationToken);
}
