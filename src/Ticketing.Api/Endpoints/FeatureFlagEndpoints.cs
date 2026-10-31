using Ticketing.Api.Http;
using Ticketing.Application.FeatureFlags;

namespace Ticketing.Api.Endpoints;

/// <summary>Feature flag administration (spec 6.13), Admins in the web app only. Flags are declared in code, so there is no create (D-168).</summary>
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

        flags.MapPatch("/{key}", async (string key, UpdateFlag.Command command, UpdateFlag.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var flag = await handler.HandleAsync(command with { Key = key, ExpectedVersion = request.ExpectedRowVersion() }, ct);
                request.HttpContext.Response.SetRowVersion(flag.RowVersion);
                return TypedResults.Ok(flag);
            })
            .WithSummary("Changes enabled, rollout percentage, target users or target roles. Send If-Match to avoid lost updates.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        flags.MapPost("/{key}/reset", async (string key, ResetFlag.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var flag = await handler.HandleAsync(new ResetFlag.Command(key, request.ExpectedRowVersion()), ct);
                request.HttpContext.Response.SetRowVersion(flag.RowVersion);
                return TypedResults.Ok(flag);
            })
            .WithSummary("Restores the default declared in code and clears all targeting. Retired flags have no default (flag.retired).")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        flags.MapDelete("/{key}", async (string key, DeleteFlag.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new DeleteFlag.Command(key), ct);
                return TypedResults.NoContent();
            })
            .WithSummary("Deletes a retired flag, one the code no longer declares; a declared flag is refused with flag.notRetired.")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }
}
