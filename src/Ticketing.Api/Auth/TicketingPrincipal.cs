using System.Globalization;
using System.Security.Claims;
using Ticketing.Application.Auth;
using Ticketing.Infrastructure.Auth;

namespace Ticketing.Api.Auth;

public static class TicketingPrincipal
{
    public static ClaimsPrincipal ForSession(SessionIdentity session, Guid sessionId) =>
        ForSession(new AuthenticatedUser(session.User.Id, session.User.Email, session.User.DisplayName, session.User.GlobalRole), session.SecurityStamp, sessionId);

    /// <param name="securityStamp">The user's stamp when the session starts; revalidation rejects the session once it changes.</param>
    /// <param name="sessionId">The server-side session (D-75); revalidation rejects the cookie once it is gone.</param>
    public static ClaimsPrincipal ForSession(AuthenticatedUser user, string securityStamp, Guid sessionId) =>
        Create(user, AuthSchemes.Cookie, [new(TicketingClaims.SecurityStamp, securityStamp), new(TicketingClaims.SessionId, sessionId.ToString())]);

    public static ClaimsPrincipal ForPat(PatAuthentication pat) => Create(pat.User, AuthSchemes.Pat,
    [
        new(TicketingClaims.PatId, pat.TokenId.ToString()),
        new(TicketingClaims.PatScope, pat.Scope.ToString()),
        new(TicketingClaims.PatExpiresAt, pat.ExpiresAt.ToString("O", CultureInfo.InvariantCulture)),
    ]);

    /// <summary>The server-side session a cookie principal belongs to, or null for PATs and anonymous callers.</summary>
    public static Guid? SessionId(ClaimsPrincipal? principal) =>
        Guid.TryParse(principal?.FindFirstValue(TicketingClaims.SessionId), out var id) ? id : null;

    private static ClaimsPrincipal Create(AuthenticatedUser user, string authenticationType, IEnumerable<Claim> extraClaims)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Name, user.DisplayName),
            new(ClaimTypes.Role, user.Role.ToString()),
        };
        claims.AddRange(extraClaims);
        return new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType));
    }
}
