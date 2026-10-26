using System.Globalization;
using System.Security.Claims;
using Ticketing.Application.Auth;
using Ticketing.Infrastructure.Auth;

namespace Ticketing.Api.Auth;

public static class TicketingPrincipal
{
    public static ClaimsPrincipal ForSession(SessionIdentity session) =>
        ForSession(new AuthenticatedUser(session.User.Id, session.User.Email, session.User.DisplayName, session.User.GlobalRole), session.SecurityStamp);

    /// <param name="securityStamp">The user's stamp when the session starts; revalidation rejects the session once it changes.</param>
    public static ClaimsPrincipal ForSession(AuthenticatedUser user, string securityStamp) => Create(user, AuthSchemes.Cookie, securityStamp);

    public static ClaimsPrincipal ForPat(PatAuthentication pat) => Create(pat.User, AuthSchemes.Pat, securityStamp: null, pat);

    private static ClaimsPrincipal Create(AuthenticatedUser user, string authenticationType, string? securityStamp, PatAuthentication? pat = null)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Name, user.DisplayName),
            new(ClaimTypes.Role, user.Role.ToString()),
        };
        if (securityStamp is not null)
            claims.Add(new Claim(TicketingClaims.SecurityStamp, securityStamp));
        if (pat is not null)
        {
            claims.Add(new Claim(TicketingClaims.PatId, pat.TokenId.ToString()));
            claims.Add(new Claim(TicketingClaims.PatScope, pat.Scope.ToString()));
            claims.Add(new Claim(TicketingClaims.PatExpiresAt, pat.ExpiresAt.ToString("O", CultureInfo.InvariantCulture)));
        }
        return new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType));
    }
}
