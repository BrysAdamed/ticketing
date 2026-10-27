using Ticketing.Application.Watchers;

namespace Ticketing.Api.Endpoints;

/// <summary>Ticket watchers (I-32): who follows a ticket, and watching or unwatching it yourself.</summary>
public sealed class WatcherEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var watchers = api.MapGroup("/tickets/{keyOrId}/watchers").WithTags("Tickets");

        watchers.MapGet("", async (string keyOrId, GetWatchers.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetWatchers.Query(keyOrId), ct)))
            .WithSummary("Watchers of a ticket who are active and can read its project, by name, and whether you watch it.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        watchers.MapPut("/me", async (string keyOrId, WatchTicket.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new WatchTicket.Command(keyOrId), ct)))
            .WithSummary("Watch the ticket (read access is enough). Idempotent.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        watchers.MapDelete("/me", async (string keyOrId, UnwatchTicket.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new UnwatchTicket.Command(keyOrId), ct)))
            .WithSummary("Stop watching the ticket until the next assignment or comment makes you a watcher again. Idempotent.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);
    }
}
