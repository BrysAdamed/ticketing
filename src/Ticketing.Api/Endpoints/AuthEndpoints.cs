using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Ticketing.Api.Auth;
using Ticketing.Api.Http;
using Ticketing.Application.Auth;

namespace Ticketing.Api.Endpoints;

public sealed class AuthEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var auth = api.MapGroup("/auth").WithTags("Auth").AllowAnonymous();

        auth.MapGet("/csrf", (HttpContext http) =>
        {
            Xsrf.IssueToken(http);
            return TypedResults.NoContent();
        })
        .WithSummary("Issues the XSRF-TOKEN cookie the SPA echoes in X-XSRF-TOKEN.");

        auth.MapPost("/login", async (Login.Command command, Login.Handler handler, HttpContext http, CancellationToken ct) =>
        {
            var session = await handler.HandleAsync(command, ct);
            await StartSessionAsync(http, session);
            return TypedResults.Ok(session.User);
        })
        .RequireRateLimiting(RateLimiting.LoginPolicy)
        .WithSummary("Signs in with email and password and starts a cookie session.")
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status423Locked)
        .ProducesProblem(StatusCodes.Status429TooManyRequests);

        auth.MapPost("/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(AuthSchemes.Cookie);
            http.User = new ClaimsPrincipal(new ClaimsIdentity());
            Xsrf.IssueToken(http);
            return TypedResults.NoContent();
        })
        .WithSummary("Ends the cookie session.");

        auth.MapPost("/set-password/inspect", async (SetPassword.InspectQuery query, SetPassword.InspectHandler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(query, ct)))
        .RequireRateLimiting(RateLimiting.LoginPolicy)
        .WithSummary("Checks a set-password link (POST, so the token stays out of URLs and logs) and returns whose it is.")
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status429TooManyRequests);

        auth.MapPost("/set-password", async (SetPassword.Command command, SetPassword.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(command, ct);
                return TypedResults.NoContent();
            })
        .RequireRateLimiting(RateLimiting.LoginPolicy)
        .WithSummary("Sets a password with a one-time link (onboarding and resets). Ends every existing session of the user.")
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status429TooManyRequests);
    }

    /// <summary>Signs the cookie session in (or re-issues it with a new security stamp) and rotates the XSRF token.</summary>
    internal static async Task StartSessionAsync(HttpContext http, SessionIdentity session)
    {
        var principal = TicketingPrincipal.ForSession(session);
        await http.SignInAsync(AuthSchemes.Cookie, principal);
        http.User = principal;
        Xsrf.IssueToken(http);
    }
}
