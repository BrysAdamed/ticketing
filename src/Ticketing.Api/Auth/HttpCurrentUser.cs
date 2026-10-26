using System.Globalization;
using System.Security.Claims;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;

namespace Ticketing.Api.Auth;

/// <summary><see cref="ICurrentUser"/> over the request principal; the same for REST endpoints and MCP tools.</summary>
internal sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private HttpContext Context => accessor.HttpContext ?? throw new InvalidOperationException("No HTTP context.");

    private ClaimsPrincipal Principal => Context.User;

    public bool IsAuthenticated => accessor.HttpContext?.User.Identity?.IsAuthenticated == true;

    public Guid Id => Guid.Parse(Required(ClaimTypes.NameIdentifier));

    public string Email => Required(ClaimTypes.Email);

    public string DisplayName => Required(ClaimTypes.Name);

    public GlobalRole Role => Enum.Parse<GlobalRole>(Required(ClaimTypes.Role));

    public WriteChannel Channel =>
        PatId is null ? WriteChannel.Web
        : Context.Request.Path.StartsWithSegments("/mcp", StringComparison.OrdinalIgnoreCase) ? WriteChannel.Mcp
        : WriteChannel.Api;

    public PatScope? PatScope =>
        Principal.FindFirstValue(TicketingClaims.PatScope) is { } scope ? Enum.Parse<PatScope>(scope) : null;

    public Guid? PatId =>
        Principal.FindFirstValue(TicketingClaims.PatId) is { } id ? Guid.Parse(id) : null;

    public DateTimeOffset? PatExpiresAt =>
        Principal.FindFirstValue(TicketingClaims.PatExpiresAt) is { } value
            ? DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind)
            : null;

    private string Required(string claimType)
    {
        if (!IsAuthenticated)
            throw new InvalidOperationException("The current request is not authenticated.");
        return Principal.FindFirstValue(claimType) ?? throw new InvalidOperationException($"Claim '{claimType}' is missing.");
    }
}
