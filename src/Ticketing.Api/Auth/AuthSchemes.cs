namespace Ticketing.Api.Auth;

public static class AuthSchemes
{
    /// <summary>Default policy scheme: <c>Authorization: Bearer</c> goes to <see cref="Pat"/>, everything else to <see cref="Cookie"/>.</summary>
    public const string Smart = "Smart";
    public const string Cookie = "Cookie";
    public const string Pat = "Pat";
}

public static class AuthPolicies
{
    /// <summary>PAT-only (the MCP endpoint). Cookie sessions get 401 there, so MCP is immune to cookie-riding CSRF.</summary>
    public const string Mcp = "Mcp";

    /// <summary>Credentials that may write: cookie sessions and ReadWrite PATs. Used to hide write MCP tools from read-only tokens.</summary>
    public const string CanWrite = "CanWrite";
}

public static class TicketingClaims
{
    public const string PatId = "pat_id";
    public const string PatScope = "pat_scope";
    public const string PatExpiresAt = "pat_expires_at";
    public const string SecurityStamp = "security_stamp";
    public const string SessionId = "session_id";
}
