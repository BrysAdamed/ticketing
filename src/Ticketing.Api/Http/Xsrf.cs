using Microsoft.AspNetCore.Antiforgery;
using Microsoft.Extensions.Options;
using Ticketing.Api.Auth;
using Ticketing.Application.Common;

namespace Ticketing.Api.Http;

/// <summary>
/// Cookie-session CSRF protection (research R6: minimal APIs do not validate antiforgery for JSON). The readable
/// <c>XSRF-TOKEN</c> cookie is echoed by Angular as <c>X-XSRF-TOKEN</c>; PAT requests are exempt.
/// </summary>
public static class Xsrf
{
    public const string CookieName = "XSRF-TOKEN";
    public const string HeaderName = "X-XSRF-TOKEN";

    public static void IssueToken(HttpContext context)
    {
        var antiforgery = context.RequestServices.GetRequiredService<IAntiforgery>();
        var secure = context.RequestServices.GetRequiredService<IOptions<AuthOptions>>().Value.CookieSecurePolicy switch
        {
            CookieSecurePolicy.Always => true,
            CookieSecurePolicy.None => false,
            _ => context.Request.IsHttps,
        };
        var tokens = antiforgery.GetAndStoreTokens(context);
        context.Response.Cookies.Append(CookieName, tokens.RequestToken!, new CookieOptions
        {
            HttpOnly = false,
            SameSite = SameSiteMode.Lax,
            Secure = secure,
            Path = "/",
        });
    }

    internal static async ValueTask<object?> ValidateAsync(EndpointFilterInvocationContext invocation, EndpointFilterDelegate next)
    {
        var context = invocation.HttpContext;
        if (Methods.IsUnsafe(context.Request.Method) && context.User.Identity?.AuthenticationType == AuthSchemes.Cookie)
        {
            var antiforgery = context.RequestServices.GetRequiredService<IAntiforgery>();
            if (!await antiforgery.IsRequestValidAsync(context))
                return Problems.Create(StatusCodes.Status400BadRequest, AppErrors.XsrfInvalid, "Missing or invalid XSRF token.",
                    "Call GET /api/v1/auth/csrf and send the XSRF-TOKEN cookie value in the X-XSRF-TOKEN header.");
        }
        return await next(invocation);
    }
}
