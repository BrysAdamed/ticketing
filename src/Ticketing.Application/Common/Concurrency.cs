using Ticketing.Application.Abstractions;

namespace Ticketing.Application.Common;

public static class Concurrency
{
    /// <summary>
    /// Applies an optional expected row version (HTTP <c>If-Match</c>, MCP <c>expectedVersion</c>) to a tracked entity:
    /// fails fast when stale and makes the UPDATE conditional on that version, so a concurrent writer also yields 409.
    /// </summary>
    public static void ExpectVersion<TEntity>(this ITicketingDbContext db, TEntity entity, uint? expectedVersion)
        where TEntity : class
    {
        if (expectedVersion is null)
            return;
        var property = db.Entry(entity).Property<uint>("RowVersion");
        if (property.CurrentValue != expectedVersion.Value)
            throw AppException.Conflict(AppErrors.ConcurrencyConflict, "The resource was changed by someone else.", "Reload it and apply your change again.");
        property.OriginalValue = expectedVersion.Value;
    }
}
