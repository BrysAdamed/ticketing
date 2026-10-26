using System.Globalization;
using System.Security.Claims;
using Ticketing.Application.Auth;
using Ticketing.Infrastructure.Auth;

namespace Ticketing.Api.Auth;

public static class TicketingPrincipal
{
    public static ClaimsPrincipal ForSession(CurrentUserDto user) =>
        Create(new AuthenticatedUser(user.Id, user.Email, user.DisplayName, user.GlobalRole), AuthSchemes.Cookie);

    public static ClaimsPrincipal ForSession(AuthenticatedUser user) => Create(user, AuthSchemes.Cookie);

    public static ClaimsPrincipal ForPat(PatAuthentication pat) => Create(pat.User, AuthSchemes.Pat, pat);

    private static ClaimsPrincipal Create(AuthenticatedUser user, string authenticationType, PatAuthentication? pat = null)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Name, user.DisplayName),
            new(ClaimTypes.Role, user.Role.ToString()),
        };
        if (pat is not null)
        {
            claims.Add(new Claim(TicketingClaims.PatId, pat.TokenId.ToString()));
            claims.Add(new Claim(TicketingClaims.PatScope, pat.Scope.ToString()));
            claims.Add(new Claim(TicketingClaims.PatExpiresAt, pat.ExpiresAt.ToString("O", CultureInfo.InvariantCulture)));
        }
        return new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType));
    }
}
