using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Ticketing.Api.Http;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.Infrastructure.Auth;

namespace Ticketing.Api.Auth;

public sealed class AuthOptions
{
    public const string Section = "Auth";

    /// <summary>Secure flag policy for the session and XSRF cookies: Always (default) or SameAsRequest for plain-HTTP setups.</summary>
    public CookieSecurePolicy CookieSecurePolicy { get; set; } = CookieSecurePolicy.Always;
}

internal static class AuthSetup
{
    public const string SessionCookieName = "tkt_session";

    public static IServiceCollection AddTicketingAuth(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(AuthOptions.Section).Get<AuthOptions>() ?? new AuthOptions();
        services.Configure<AuthOptions>(configuration.GetSection(AuthOptions.Section));
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, HttpCurrentUser>();

        services
            .AddAuthentication(AuthSchemes.Smart)
            .AddPolicyScheme(AuthSchemes.Smart, AuthSchemes.Smart, o =>
            {
                o.ForwardDefaultSelector = context =>
                    context.Request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                        ? AuthSchemes.Pat
                        : ExportLinkAuthenticationHandler.Applies(context.Request)
                            ? AuthSchemes.ExportLink
                            : AuthSchemes.Cookie;
            })
            .AddCookie(AuthSchemes.Cookie, o =>
            {
                o.Cookie.Name = SessionCookieName;
                o.Cookie.HttpOnly = true;
                o.Cookie.SameSite = SameSiteMode.Lax;
                o.Cookie.SecurePolicy = options.CookieSecurePolicy;
                o.SlidingExpiration = true;
                o.ExpireTimeSpan = UserSession.IdleTimeout;
                o.Events.OnRedirectToLogin = context => SetStatus(context.Response, StatusCodes.Status401Unauthorized);
                o.Events.OnRedirectToAccessDenied = context => SetStatus(context.Response, StatusCodes.Status403Forbidden);
                o.Events.OnValidatePrincipal = RevalidateSessionAsync;
            })
            .AddScheme<AuthenticationSchemeOptions, PatAuthenticationHandler>(AuthSchemes.Pat, null)
            .AddScheme<AuthenticationSchemeOptions, ExportLinkAuthenticationHandler>(AuthSchemes.ExportLink, null);

        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
            .AddPolicy(AuthPolicies.Mcp, p => p.AddAuthenticationSchemes(AuthSchemes.Pat).RequireAuthenticatedUser())
            .AddPolicy(AuthPolicies.CanWrite, p => p.RequireAssertion(c =>
                c.User.FindFirstValue(TicketingClaims.PatScope) is not { } scope || scope == nameof(PatScope.ReadWrite)));

        services.AddAntiforgery(o =>
        {
            o.HeaderName = Xsrf.HeaderName;
            o.Cookie.Name = "tkt_af";
            o.Cookie.SecurePolicy = options.CookieSecurePolicy;
        });
        return services;
    }

    /// <summary>
    /// Re-reads the session and user on every cookie request, so sign-out, deactivation and password changes end sessions
    /// immediately (spec 4.1, 6.14, D-75) and role or name changes apply without a new login.
    /// </summary>
    private static async Task RevalidateSessionAsync(CookieValidatePrincipalContext context)
    {
        var id = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var stamp = context.Principal?.FindFirstValue(TicketingClaims.SecurityStamp);
        var store = context.HttpContext.RequestServices.GetRequiredService<IAuthenticationStore>();
        if (!Guid.TryParse(id, out var userId)
            || TicketingPrincipal.SessionId(context.Principal) is not { } sessionId
            || await store.FindSessionUserAsync(sessionId, userId, context.HttpContext.RequestAborted) is not { } user
            || !string.Equals(user.SecurityStamp, stamp, StringComparison.Ordinal))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(AuthSchemes.Cookie);
            return;
        }
        context.ReplacePrincipal(TicketingPrincipal.ForSession(user.User, user.SecurityStamp, sessionId));
    }

    private static Task SetStatus(HttpResponse response, int statusCode)
    {
        response.StatusCode = statusCode;
        return Task.CompletedTask;
    }
}
