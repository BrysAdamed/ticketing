using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Ticketing.Api.Auth;
using Ticketing.Api.Http;
using Ticketing.Application.Auth;
using Ticketing.Infrastructure.Auth;

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
            await StartSessionAsync(http, session, ct);
            return TypedResults.Ok(session.User);
        })
        .RequireRateLimiting(RateLimiting.LoginPolicy)
        .WithSummary("Signs in with email and password and starts a cookie session.")
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status429TooManyRequests);

        auth.MapPost("/logout", async (HttpContext http, IAuthenticationStore sessions, CancellationToken ct) =>
        {
            if (TicketingPrincipal.SessionId(http.User) is { } sessionId)
                await sessions.EndSessionAsync(sessionId, ct);
            await http.SignOutAsync(AuthSchemes.Cookie);
            http.User = new ClaimsPrincipal(new ClaimsIdentity());
            Xsrf.IssueToken(http);
            return TypedResults.NoContent();
        })
        .WithSummary("Ends the cookie session on the server, so a copy of the cookie stops working too.");

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

    /// <summary>
    /// Starts a server-side session and signs its cookie in (replacing the caller's current session, for example after a
    /// password change re-issues it with a new security stamp), and rotates the XSRF token.
    /// </summary>
    internal static async Task StartSessionAsync(HttpContext http, SessionIdentity session, CancellationToken cancellationToken)
    {
        var sessions = http.RequestServices.GetRequiredService<IAuthenticationStore>();
        if (TicketingPrincipal.SessionId(http.User) is { } previous)
            await sessions.EndSessionAsync(previous, cancellationToken);
        var principal = TicketingPrincipal.ForSession(session, await sessions.StartSessionAsync(session.User.Id, cancellationToken));
        await http.SignInAsync(AuthSchemes.Cookie, principal);
        http.User = principal;
        Xsrf.IssueToken(http);
    }
}
