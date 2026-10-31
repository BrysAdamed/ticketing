using Ticketing.Application.Notifications;

namespace Ticketing.Api.Endpoints;

/// <summary>The signed-in user's notification preferences: muted kinds and projects (D-160).</summary>
public sealed class NotificationPreferenceEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var preferences = api.MapGroup("/me/notification-preferences").WithTags("Me");

        preferences.MapGet("", async (GetNotificationPreferences.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetNotificationPreferences.Query(), ct)))
            .WithSummary("Your notification preferences: every kind with muted and direct, and the projects you muted.");

        preferences.MapPatch("", async (UpdateNotificationPreferences.Command command, UpdateNotificationPreferences.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command, ct)))
            .WithSummary("Mutes or unmutes kinds and projects: { muteKinds, unmuteKinds, muteProjects, unmuteProjects } (projects by key or id). "
                + "Returns the preferences afterwards.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }
}
