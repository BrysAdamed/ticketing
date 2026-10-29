using Ticketing.Api.Http;
using Ticketing.Application.Onboarding;

namespace Ticketing.Api.Endpoints;

/// <summary>The signed-in user's onboarding state (D-132). REST only, no MCP tools: it is personal UI state.</summary>
public sealed class OnboardingEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var onboarding = api.MapGroup("/me/onboarding").WithTags("Me");

        onboarding.MapGet("", async (GetMyOnboarding.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetMyOnboarding.Query(), ct)))
            .WithSummary("Your getting-started checklist, the guides you completed or dismissed, whether you own a project, and when your account was created.");

        onboarding.MapPut("/guides/{guideId}", async (string guideId, SetGuideState.Command command, SetGuideState.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command with { GuideId = guideId }, ct)))
            .RequireCookieSession()
            .WithSummary("Records that you completed or dismissed a version of a guide (web session only). At most 200 guides per user.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);

        onboarding.MapDelete("/guides/{guideId}", async (string guideId, ForgetGuide.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new ForgetGuide.Command(guideId), ct);
                return TypedResults.NoContent();
            })
            .RequireCookieSession()
            .WithSummary("Forgets one guide you completed or dismissed, so it shows again (web session only).")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden);

        onboarding.MapDelete("/guides", async (ResetMyGuides.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new ResetMyGuides.Command(), ct);
                return TypedResults.NoContent();
            })
            .RequireCookieSession()
            .WithSummary("Forgets every guide you completed or dismissed, so they show again (web session only).")
            .ProducesProblem(StatusCodes.Status403Forbidden);
    }
}
