using System.Security.Claims;
using Ticketing.Api.Auth;
using Ticketing.Application.Common;
using Ticketing.Domain.Tokens;

namespace Ticketing.Api.Http;

/// <summary>Transport-level credential rules for REST (spec 5.5). The application layer re-checks them, so MCP gets the same behaviour.</summary>
public static class CredentialFilters
{
    /// <summary>Applied to the whole API: read-only PATs may only use safe methods.</summary>
    internal static async ValueTask<object?> RejectReadOnlyTokenWritesAsync(EndpointFilterInvocationContext invocation, EndpointFilterDelegate next)
    {
        var context = invocation.HttpContext;
        if (Methods.IsUnsafe(context.Request.Method) && context.User.FindFirstValue(TicketingClaims.PatScope) == nameof(PatScope.ReadOnly))
            return Problems.Create(StatusCodes.Status403Forbidden, AppErrors.ReadOnlyToken, "This token is read-only.", "Create a ReadWrite token to make changes.");
        return await next(invocation);
    }

    /// <summary>Restricts endpoints to the web session: PAT, password, user and flag management (spec 5.5).</summary>
    public static TBuilder RequireCookieSession<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.AddEndpointFilter(async (invocation, next) =>
            invocation.HttpContext.User.Identity?.AuthenticationType == AuthSchemes.Pat
                ? Problems.Create(StatusCodes.Status403Forbidden, AppErrors.CookieSessionRequired, "This endpoint is only available in the web application.")
                : await next(invocation));
}
