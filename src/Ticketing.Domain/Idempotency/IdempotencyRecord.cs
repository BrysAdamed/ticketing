namespace Ticketing.Domain.Idempotency;

/// <summary>The stored result of a create operation keyed by (user, Idempotency-Key), replayed for 24 hours (spec 8, I-25).</summary>
public sealed class IdempotencyRecord
{
    public const int KeyMaxLength = 200;
    public const int OperationMaxLength = 100;
    public static readonly TimeSpan Retention = TimeSpan.FromHours(24);

    private IdempotencyRecord()
    {
        Key = null!;
        Operation = null!;
        RequestHash = null!;
        ResultJson = null!;
    }

    public Guid UserId { get; private set; }

    public string Key { get; private set; }

    public string Operation { get; private set; }

    public string RequestHash { get; private set; }

    public string ResultJson { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset ExpiresAt { get; private set; }

    public static IdempotencyRecord Create(Guid userId, string key, string operation, string requestHash, string resultJson, DateTimeOffset now) => new()
    {
        UserId = userId,
        Key = key,
        Operation = operation,
        RequestHash = requestHash,
        ResultJson = resultJson,
        CreatedAt = now,
        ExpiresAt = now + Retention,
    };

    public bool IsExpired(DateTimeOffset now) => ExpiresAt <= now;
}
