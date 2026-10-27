namespace Ticketing.Domain.Users;

/// <summary>
/// Failed sign-ins for one account from one client address (spec 6.14, D-74). Five in a row lock that pair for 15 minutes,
/// so a guesser cannot lock the account out for everyone else.
/// </summary>
public sealed class LoginThrottle
{
    public const int MaxFailedLogins = 5;
    public const int ClientAddressMaxLength = 45;
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    /// <summary>Rows without a failure for this long are purged, which also forgets their failure count.</summary>
    public static readonly TimeSpan Retention = TimeSpan.FromDays(1);

    private LoginThrottle() => ClientAddress = null!;

    public Guid UserId { get; private set; }

    public string ClientAddress { get; private set; }

    public int FailedCount { get; private set; }

    public DateTimeOffset? LockedUntil { get; private set; }

    public DateTimeOffset LastFailedAt { get; private set; }

    public static LoginThrottle Create(Guid userId, string clientAddress)
    {
        ArgumentOutOfRangeException.ThrowIfGreaterThan(clientAddress.Length, ClientAddressMaxLength, nameof(clientAddress));
        return new LoginThrottle { UserId = userId, ClientAddress = clientAddress };
    }

    public bool IsLockedOut(DateTimeOffset now) => LockedUntil is { } until && until > now;

    /// <summary>Counts a failed password attempt. Returns true when this attempt locked the pair.</summary>
    public bool RegisterFailure(DateTimeOffset now)
    {
        LastFailedAt = now;
        FailedCount++;
        if (FailedCount < MaxFailedLogins)
            return false;
        FailedCount = 0;
        LockedUntil = now + LockoutDuration;
        return true;
    }
}
