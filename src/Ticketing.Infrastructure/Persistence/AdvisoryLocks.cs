using Microsoft.EntityFrameworkCore;

namespace Ticketing.Infrastructure.Persistence;

/// <summary>PostgreSQL transaction-scoped advisory locks keyed by a string; released on commit or rollback.</summary>
internal static class AdvisoryLocks
{
    public static async Task AcquireAsync(TicketingDbContext db, string key, CancellationToken cancellationToken)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Advisory locks need an open transaction; wrap the work in InTransactionAsync.");
        await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", cancellationToken);
    }
}
