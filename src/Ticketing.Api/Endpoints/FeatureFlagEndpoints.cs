using Ticketing.Api.Http;
using Ticketing.Application.FeatureFlags;

namespace Ticketing.Api.Endpoints;

/// <summary>Feature flag administration (spec 6.13), Admins in the web app only.</summary>
public sealed class FeatureFlagEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var flags = api.MapGroup("/admin/flags").WithTags("Admin: feature flags").RequireCookieSession()
            .ProducesProblem(StatusCodes.Status403Forbidden);

        flags.MapGet("", async (ListFlags.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new ListFlags.Query(), ct)))
            .WithSummary("All flags with how many active users currently evaluate on.");

        flags.MapGet("/{key}", async (string key, GetFlag.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var flag = await handler.HandleAsync(new GetFlag.Query(key), ct);
                response.SetRowVersion(flag.RowVersion);
                return TypedResults.Ok(flag);
            })
            .WithSummary("A flag by key.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        flags.MapPost("", async (CreateFlag.Command command, CreateFlag.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var flag = await handler.HandleAsync(command, ct);
                response.SetRowVersion(flag.RowVersion);
                return TypedResults.Created($"/api/v1/admin/flags/{flag.Key}", flag);
            })
            .WithSummary("Creates a flag. Keys look like board.swimlanes or ticket-view.v2 and never change.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);

        flags.MapPatch("/{key}", async (string key, UpdateFlag.Command command, UpdateFlag.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var flag = await handler.HandleAsync(command with { Key = key, ExpectedVersion = request.ExpectedRowVersion() }, ct);
                request.HttpContext.Response.SetRowVersion(flag.RowVersion);
                return TypedResults.Ok(flag);
            })
            .WithSummary("Changes description, enabled, rollout percentage, target users or target roles. Send If-Match to avoid lost updates.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        flags.MapDelete("/{key}", async (string key, DeleteFlag.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new DeleteFlag.Command(key), ct);
                return TypedResults.NoContent();
            })
            .WithSummary("Deletes a flag; it evaluates off for everyone afterwards.")
            .ProducesProblem(StatusCodes.Status404NotFound);
    }
}
