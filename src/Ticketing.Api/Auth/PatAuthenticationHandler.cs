using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Ticketing.Infrastructure.Auth;

namespace Ticketing.Api.Auth;

/// <summary>Authenticates <c>Authorization: Bearer tkt_…</c>. Failures are a plain 401 that never says whether the token exists.</summary>
internal sealed class PatAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IAuthenticationStore store)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    private const string BearerPrefix = "Bearer ";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        string? header = Request.Headers.Authorization;
        if (header is null || !header.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase))
            return AuthenticateResult.NoResult();

        var pat = await store.AuthenticatePatAsync(header[BearerPrefix.Length..].Trim(), Context.RequestAborted);
        return pat is null
            ? AuthenticateResult.Fail("Invalid or expired token.")
            : AuthenticateResult.Success(new AuthenticationTicket(TicketingPrincipal.ForPat(pat), Scheme.Name));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        Response.Headers.WWWAuthenticate = "Bearer";
        return Task.CompletedTask;
    }
}
