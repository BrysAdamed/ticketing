using Ticketing.Application.Watchers;

namespace Ticketing.Api.Endpoints;

/// <summary>Doc watchers (I-85, D-161): who follows a page or diagram, and watching or unwatching it yourself.</summary>
public sealed class DocWatcherEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var watchers = api.MapGroup("/docs/{keyOrId}/watchers").WithTags("Docs");

        watchers.MapGet("", async (string keyOrId, GetDocWatchers.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetDocWatchers.Query(keyOrId), ct)))
            .WithSummary("Watchers of a page or diagram who are active and can read its project, by name, and whether you watch it.")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        watchers.MapPut("/me", async (string keyOrId, WatchDoc.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new WatchDoc.Command(keyOrId), ct)))
            .WithSummary("Watch the page or diagram (read access is enough). Idempotent.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        watchers.MapDelete("/me", async (string keyOrId, UnwatchDoc.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new UnwatchDoc.Command(keyOrId), ct)))
            .WithSummary("Stop watching the page or diagram until your next comment or a new mention makes you a watcher again. Idempotent.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }
}
