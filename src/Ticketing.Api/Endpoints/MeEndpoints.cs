using Ticketing.Application.Me;

namespace Ticketing.Api.Endpoints;

public sealed class MeEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var me = api.MapGroup("/me").WithTags("Me");

        me.MapGet("", async (GetMe.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new GetMe.Query(), ct)))
            .WithSummary("The signed-in user.");

        me.MapGet("/flags", async (GetMyFlags.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new GetMyFlags.Query(), ct)))
            .WithSummary("Feature flag variants for the signed-in user.");
    }
}
