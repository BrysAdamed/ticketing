using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Ticketing.Application.Abstractions;
using Ticketing.Infrastructure.Auth;

namespace Ticketing.Api.Auth;

/// <summary>
/// Authenticates <c>GET …/export.pdf?token=…</c> with a signed export link (MCP <c>get_doc_export_link</c>): the link's user,
/// while active and with an unchanged security stamp, limited to the linked doc. Anything invalid is no result, which the
/// export endpoint answers with 404.
/// </summary>
internal sealed class ExportLinkAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IDocExportLinks links,
    IAuthenticationStore store)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string TokenParameter = "token";

    /// <summary>Requests the default scheme forwards here: an export path carrying a token.</summary>
    public static bool Applies(HttpRequest request) =>
        request.Query.ContainsKey(TokenParameter)
        && request.Path.Value?.EndsWith("/export.pdf", StringComparison.OrdinalIgnoreCase) == true;

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (Request.Query[TokenParameter].ToString() is not { Length: > 0 } token || links.Read(token) is not { } grant)
            return AuthenticateResult.NoResult();
        var user = await store.FindActiveUserAsync(grant.UserId, Context.RequestAborted);
        if (user is null || !string.Equals(user.SecurityStamp, grant.SecurityStamp, StringComparison.Ordinal))
            return AuthenticateResult.NoResult();
        return AuthenticateResult.Success(new AuthenticationTicket(TicketingPrincipal.ForExportLink(user.User, grant), Scheme.Name));
    }
}
