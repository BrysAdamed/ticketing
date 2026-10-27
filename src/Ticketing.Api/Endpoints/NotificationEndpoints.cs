using Ticketing.Application.Common;
using Ticketing.Application.Notifications;

namespace Ticketing.Api.Endpoints;

/// <summary>The signed-in user's in-app notifications (I-30, D-94).</summary>
public sealed class NotificationEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var notifications = api.MapGroup("/me/notifications").WithTags("Me");

        notifications.MapGet("", async (bool? unread, int? limit, string? cursor, ListNotifications.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListNotifications.Query(unread ?? false, new PageRequest(limit, cursor)), ct)))
            .WithSummary("Your notifications, newest first (cursor paging). unread=true lists only unread ones.")
            .ProducesProblem(StatusCodes.Status400BadRequest);

        notifications.MapGet("/unread-count", async (GetUnreadNotificationCount.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetUnreadNotificationCount.Query(), ct)))
            .WithSummary("How many of your notifications are unread.");

        notifications.MapPost("/read", async (MarkNotificationsRead.Command command, MarkNotificationsRead.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command, ct)))
            .WithSummary("Marks notifications read: { \"ids\": [...] } (1 to 100) or { \"all\": true }. Returns the new unread count.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden);
    }
}
