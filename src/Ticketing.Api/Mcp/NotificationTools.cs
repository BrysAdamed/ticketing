using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.Notifications;

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
}
