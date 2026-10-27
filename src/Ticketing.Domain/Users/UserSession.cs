using Ticketing.Domain.Common;

namespace Ticketing.Domain.Users;

/// <summary>
/// A signed-in web session (D-75). The session cookie names it, and signing out deletes it, so a copied cookie stops
/// working even before it expires.
/// </summary>
public sealed class UserSession
{
    /// <summary>The cookie's sliding expiry (spec 6.14).</summary>
    public static readonly TimeSpan IdleTimeout = TimeSpan.FromHours(12);

    /// <summary><see cref="LastSeenAt"/> is written at most this often.</summary>
    public static readonly TimeSpan TouchInterval = TimeSpan.FromMinutes(5);

    private UserSession()
    {
    }

    public Guid Id { get; private set; }

    public Guid UserId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset LastSeenAt { get; private set; }

    public static UserSession Start(Guid userId, DateTimeOffset now) => new()
    {
        Id = EntityId.New(),
        UserId = userId,
        CreatedAt = now,
        LastSeenAt = now,
    };

    public static bool ShouldTouch(DateTimeOffset lastSeenAt, DateTimeOffset now) => now - lastSeenAt >= TouchInterval;

    /// <summary>Sessions last seen before this moment can no longer have a valid cookie.</summary>
    public static DateTimeOffset IdleCutoff(DateTimeOffset now) => now - IdleTimeout - TouchInterval;
}
