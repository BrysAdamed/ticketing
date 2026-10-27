using Ticketing.Api.Http;
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

        me.MapPatch("", async (UpdateMyProfile.Command command, UpdateMyProfile.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(command, ct)))
            .RequireCookieSession()
            .WithSummary("Changes the signed-in user's display name (web session only).")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden);

        me.MapPost("/password", async (ChangeMyPassword.Command command, ChangeMyPassword.Handler handler, HttpContext http, CancellationToken ct) =>
            {
                var session = await handler.HandleAsync(command, ct);
                await AuthEndpoints.StartSessionAsync(http, session, ct);
                return TypedResults.NoContent();
            })
            .RequireCookieSession()
            .WithSummary("Changes the signed-in user's password (current password required). Other sessions end; this one continues.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden);
    }
}
