using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Idempotency;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Infrastructure.Idempotency;

/// <summary>
/// Requests with the same (user, key) are serialised by a transaction-scoped advisory lock: the first one runs the
/// create and stores its result in the same transaction, later ones wait and replay it. Only expired records are replaced.
/// </summary>
internal sealed class IdempotencyService(TicketingDbContext db, ICurrentUser currentUser, IClock clock) : IIdempotency
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<T> ExecuteAsync<T>(
        string? key, string operation, object request, Func<CancellationToken, Task<T>> action, CancellationToken cancellationToken)
    {
        if (key is null)
            return await action(cancellationToken);
        key = key.Trim();
        if (key.Length is 0 or > IdempotencyRecord.KeyMaxLength)
            throw AppException.Invalid("idempotencyKey", $"The idempotency key must be 1..{IdempotencyRecord.KeyMaxLength} characters.");

        var userId = currentUser.Id;
        var requestHash = Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(request, request.GetType(), Json)));

        var (found, replayed) = await FindAsync<T>(userId, key, operation, requestHash, cancellationToken);
        if (found)
            return replayed!;

        return await db.InTransactionAsync(
            async ct =>
            {
                await AdvisoryLocks.AcquireAsync(db, $"idempotency:{userId}:{key}", ct);
                var (foundAfterLock, winner) = await FindAsync<T>(userId, key, operation, requestHash, ct);
                if (foundAfterLock)
                    return winner!;

                var now = clock.Now;
                await db.IdempotencyRecords.Where(r => r.UserId == userId && r.Key == key && r.ExpiresAt <= now).ExecuteDeleteAsync(ct);
                var result = await action(ct);
                db.IdempotencyRecords.Add(IdempotencyRecord.Create(userId, key, operation, requestHash, JsonSerializer.Serialize(result, Json), now));
                await db.SaveChangesAsync(ct);
                return result;
            },
            cancellationToken);
    }

    private async Task<(bool Found, T? Result)> FindAsync<T>(Guid userId, string key, string operation, string requestHash, CancellationToken cancellationToken)
    {
        var record = await db.IdempotencyRecords.AsNoTracking().SingleOrDefaultAsync(r => r.UserId == userId && r.Key == key, cancellationToken);
        if (record is null || record.IsExpired(clock.Now))
            return (false, default);
        if (record.Operation != operation || record.RequestHash != requestHash)
            throw AppException.Conflict(
                AppErrors.IdempotencyKeyReused, "This idempotency key was already used for a different request.", "Use a new key for a new request.");
        return (true, JsonSerializer.Deserialize<T>(record.ResultJson, Json));
    }
}
