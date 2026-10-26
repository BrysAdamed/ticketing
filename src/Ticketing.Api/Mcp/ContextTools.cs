using System.ComponentModel;
using ModelContextProtocol.Server;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;

namespace Ticketing.Api.Mcp;

[McpServerToolType]
public sealed class ContextTools
{
    [McpServerTool(Name = "whoami", ReadOnly = true, Idempotent = true, Title = "Who am I")]
    [Description("Returns the user this token acts as (email, name, global role), the token scope and expiry, and the server version.")]
    public static WhoAmIResult WhoAmI(ICurrentUser currentUser) => new(
        currentUser.Email,
        currentUser.DisplayName,
        currentUser.Role,
        currentUser.PatScope,
        currentUser.PatExpiresAt,
        ServerVersion.Current);
}

public sealed record WhoAmIResult(
    string Email, string DisplayName, GlobalRole GlobalRole, PatScope? TokenScope, DateTimeOffset? TokenExpiresAt, string ServerVersion);
