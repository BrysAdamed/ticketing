using Microsoft.AspNetCore.Authentication;
using System.Security.Claims;
using Ticketing.Api.Auth;
using Ticketing.Api.Http;
using Ticketing.Application.Auth;

namespace Ticketing.Api.Endpoints;

public static class AuthEndpoints
{
    public static RouteGroupBuilder MapAuthEndpoints(this RouteGroupBuilder api)
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
            var user = await handler.HandleAsync(command, ct);
            var principal = TicketingPrincipal.ForSession(user);
            await http.SignInAsync(AuthSchemes.Cookie, principal);
            http.User = principal;
            Xsrf.IssueToken(http);
            return TypedResults.Ok(user);
        })
        .WithSummary("Signs in with email and password and starts a cookie session.")
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status423Locked);

        auth.MapPost("/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(AuthSchemes.Cookie);
            http.User = new ClaimsPrincipal(new ClaimsIdentity());
            Xsrf.IssueToken(http);
            return TypedResults.NoContent();
        })
        .WithSummary("Ends the cookie session.");

        return api;
    }
}
