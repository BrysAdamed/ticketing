using Ticketing.Domain.Common;

namespace Ticketing.Domain.Tokens;

public sealed class PersonalAccessToken
{
    public const string TokenPrefix = "tkt_";
    public const int SecretLength = 40;
    public const int DisplayPrefixLength = 12;
    public const int NameMaxLength = 100;
    public const int MaxActivePerUser = 20;
    public static readonly TimeSpan MaxLifetime = TimeSpan.FromDays(365);
    public static readonly TimeSpan LastUsedResolution = TimeSpan.FromMinutes(5);

    private PersonalAccessToken()
    {
        Name = null!;
        Prefix = null!;
        TokenHash = null!;
    }

    public Guid Id { get; private set; }

    public Guid UserId { get; private set; }

    public string Name { get; private set; }

    public PatScope Scope { get; private set; }

    /// <summary><c>tkt_</c> plus the first 8 characters of the secret, shown in lists.</summary>
    public string Prefix { get; private set; }

    /// <summary>SHA-256 (lower-case hex) of the full token.</summary>
    public string TokenHash { get; private set; }

    public DateTimeOffset ExpiresAt { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? LastUsedAt { get; private set; }

    public DateTimeOffset? RevokedAt { get; private set; }

    public Guid? RevokedById { get; private set; }

    public static PersonalAccessToken Create(
        Guid userId, string name, PatScope scope, string prefix, string tokenHash, DateTimeOffset expiresAt, DateTimeOffset now)
    {
        if (expiresAt <= now || expiresAt > now + MaxLifetime)
            throw DomainException.Invalid("expiresAt", "pat.expiry.invalid", "Expiry must be in the future and at most 365 days away.");

        return new PersonalAccessToken
        {
            Id = EntityId.New(),
            UserId = userId,
            Name = Text.SingleLine(name, "name", NameMaxLength),
            Scope = scope,
            Prefix = prefix,
            TokenHash = tokenHash,
            ExpiresAt = expiresAt,
            CreatedAt = now,
        };
    }

    public bool IsActive(DateTimeOffset now) => RevokedAt is null && ExpiresAt > now;

    public void Revoke(Guid actorId, DateTimeOffset now)
    {
        if (RevokedAt is not null)
            return;
        RevokedAt = now;
        RevokedById = actorId;
    }

    /// <summary>LastUsedAt is written at most once per <see cref="LastUsedResolution"/> to keep auth reads cheap.</summary>
    public static bool ShouldRecordUse(DateTimeOffset? lastUsedAt, DateTimeOffset now) =>
        lastUsedAt is null || now - lastUsedAt.Value >= LastUsedResolution;
}
