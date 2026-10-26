using Ticketing.Domain.Activity;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Abstractions;

/// <summary>
/// The authenticated caller of the current operation, identical for REST (cookie or PAT) and MCP.
/// Accessing identity members when <see cref="IsAuthenticated"/> is false throws.
/// </summary>
public interface ICurrentUser
{
    bool IsAuthenticated { get; }

    Guid Id { get; }

    string Email { get; }

    string DisplayName { get; }

    GlobalRole Role { get; }

    bool IsAdmin => Role == GlobalRole.Admin;

    /// <summary>Web for cookie sessions, Api for PATs over REST, Mcp for PATs over /mcp.</summary>
    WriteChannel Channel { get; }

    /// <summary>The token's scope when authenticated with a PAT; null for cookie sessions.</summary>
    PatScope? PatScope { get; }

    Guid? PatId { get; }

    DateTimeOffset? PatExpiresAt { get; }
}
