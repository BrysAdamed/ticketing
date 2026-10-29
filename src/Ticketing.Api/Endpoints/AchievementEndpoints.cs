using Ticketing.Application.Achievements;

namespace Ticketing.Api.Endpoints;

/// <summary>The caller's own achievements (spec 15.6). 404 <c>achievements.disabled</c> while the flag is off or after an opt-out.</summary>
public sealed class AchievementEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var achievements = api.MapGroup("/me/achievements").WithTags("Me");

        achievements.MapGet("", async (ListMyAchievements.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListMyAchievements.Query(), ct)))
            .WithSummary("Your achievements: the whole catalogue with the tiers you earned, when you earned and saw them, and your live progress. Secret ones stay masked until earned.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        achievements.MapGet("/unseen", async (GetUnseenAchievements.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetUnseenAchievements.Query(), ct)))
            .WithSummary("Your earned tiers you have not seen yet, oldest first: { count, items }.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        achievements.MapPost("/seen", async (MarkAchievementsSeen.Command command, MarkAchievementsSeen.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command, ct)))
            .WithSummary("Marks every earned tier of the given achievements seen: { \"ids\": [...] } (1 to 100). Returns what is still unseen.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);
    }
}
