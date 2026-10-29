using Ticketing.Application.Achievements;

namespace Ticketing.Api.Endpoints;

/// <summary>
/// The caller's own achievements and sharing them (spec 15.6, 15.7), and another user's shared ones. 404
/// <c>achievements.disabled</c> while the flag is off for the caller, and for the caller's own after an opt-out.
/// </summary>
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

        achievements.MapPut("/{id}/share", async (string id, SetAchievementSharing.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new SetAchievementSharing.Command(id, Shared: true), ct)))
            .WithSummary("Shares an earned achievement with every signed-in user: they see its name, icon and your highest tier, never dates. Idempotent; returns the item. achievements.notEarned (404) when not earned.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        achievements.MapDelete("/{id}/share", async (string id, SetAchievementSharing.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new SetAchievementSharing.Command(id, Shared: false), ct)))
            .WithSummary("Stops sharing an earned achievement. Idempotent; returns the item. achievements.notEarned (404) when not earned.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        api.MapGet("/users/{userId:guid}/achievements", async (Guid userId, ListSharedAchievements.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListSharedAchievements.Query(userId), ct)))
            .WithTags("Users")
            .WithSummary("A user's shared achievements, in catalogue order: { items: [{ id, name, icon, tier }] }. Never dates; Admins see no more. 404 while achievements are off for you or the user, or the user is unknown, deactivated or opted out.")
            .ProducesProblem(StatusCodes.Status404NotFound);
    }
}
