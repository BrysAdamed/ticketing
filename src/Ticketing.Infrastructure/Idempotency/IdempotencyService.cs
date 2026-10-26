using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Idempotency;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Infrastructure.Idempotency;

/// <summary>
/// Runs the create and stores its result in the same transaction. A concurrent duplicate loses on the primary key,
/// rolls back its own create and replays the winner's result.
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

        var replay = await FindAsync<T>(userId, key, operation, requestHash, cancellationToken);
        if (replay.Found)
            return replay.Result!;

        try
        {
            return await db.InTransactionAsync(
                async ct =>
                {
                    await db.IdempotencyRecords.Where(r => r.UserId == userId && r.Key == key).ExecuteDeleteAsync(ct);
                    var result = await action(ct);
                    db.IdempotencyRecords.Add(IdempotencyRecord.Create(
                        userId, key, operation, requestHash, JsonSerializer.Serialize(result, Json), clock.Now));
                    await db.SaveChangesAsync(ct);
                    return result;
                },
                cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.IsUniqueViolation())
        {
            db.ChangeTracker.Clear();
            replay = await FindAsync<T>(userId, key, operation, requestHash, cancellationToken);
            if (replay.Found)
                return replay.Result!;
            throw;
        }
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
