using Ticketing.Domain.Activity;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Abstractions;

/// <summary>Password hashing in ASP.NET Core Identity's <c>PasswordHasher</c> format (spec 4.1).</summary>
public interface IPasswordHasher
{
    string Hash(User user, string password);

    PasswordCheck Verify(User user, string passwordHash, string password);
}

public enum PasswordCheck
{
    Failed = 0,
    Success = 1,
    SuccessRehashNeeded = 2,
}

/// <summary>The caller's network address after trusted proxies are unwrapped (D-73), used for per-client sign-in limits.</summary>
public interface IClientAddress
{
    string Value { get; }
}

/// <summary>Personal access token secrets: <c>tkt_</c> + 40 base62 characters, stored only as a SHA-256 hex hash (spec 4.2).</summary>
public interface IPatTokenGenerator
{
    GeneratedPat Generate();

    string Hash(string token);
}

/// <param name="Token">The full secret, shown to the user exactly once.</param>
/// <param name="Prefix">The displayable prefix (<c>tkt_</c> + 8 characters).</param>
/// <param name="Hash">What gets stored.</param>
public sealed record GeneratedPat(string Token, string Prefix, string Hash);

/// <summary>Race-free, gap-tolerant per-project numbers (spec 4.5, D-42). Call inside the transaction that inserts the numbered entity.</summary>
public interface IProjectCounters
{
    Task<int> NextAsync(Guid projectId, CounterKind kind, CancellationToken cancellationToken);
}

/// <summary>Writes activity entries (history and audit) into the current unit of work; they are saved with the change itself.</summary>
public interface IActivityLog
{
    void Record(ActivityEntityType entityType, Guid entityId, Guid? projectId, string action, object? newValue = null);

    /// <summary>Records a field change, or nothing when the values are equal.</summary>
    void RecordChange<T>(ActivityEntityType entityType, Guid entityId, Guid? projectId, string action, string field, T oldValue, T newValue);
}

/// <summary>Cached source of feature flag definitions; invalidate after an admin edit.</summary>
public interface IFeatureFlagStore
{
    Task<IReadOnlyList<FeatureFlag>> GetAllAsync(CancellationToken cancellationToken);

    void Invalidate();
}

/// <summary>Stores attachment bytes (PostgreSQL today, D-15), so the backend can move to a volume or blob store later.</summary>
public interface IAttachmentStore
{
    Task SaveAsync(Guid attachmentId, ReadOnlyMemory<byte> content, CancellationToken cancellationToken);

    Task<Stream?> OpenReadAsync(Guid attachmentId, CancellationToken cancellationToken);

    Task DeleteAsync(Guid attachmentId, CancellationToken cancellationToken);
}

/// <summary>Replays create results for a repeated <c>Idempotency-Key</c> from the same user within 24 hours (spec 8).</summary>
public interface IIdempotency
{
    /// <param name="key">The client's key; when null the action simply runs.</param>
    /// <param name="operation">A stable operation name, for example <c>projects.create</c>.</param>
    /// <param name="request">The request payload; a different payload under the same key is rejected with <c>idempotency.keyReused</c>.</param>
    /// <param name="action">The create operation. Its result must round-trip through System.Text.Json.</param>
    Task<T> ExecuteAsync<T>(string? key, string operation, object request, Func<CancellationToken, Task<T>> action, CancellationToken cancellationToken);
}
