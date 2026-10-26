using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Regressions;

namespace Ticketing.Application.Regressions;

internal static class RegressionItemWrites
{
    /// <summary>
    /// Inside a transaction: share-locks the session, ensures it is still in progress and returns the session and the
    /// tracked item. The item's row version makes concurrent changes to the same item fail with 409.
    /// </summary>
    public static async Task<(RegressionSession Session, RegressionSessionItem Item)> LoadForUpdateAsync(
        ITicketingDbContext db, RegressionTarget target, Guid itemId, CancellationToken cancellationToken)
    {
        await RegressionLocks.ShareAsync(db, target.Id, cancellationToken);
        var session = await db.RegressionSessions.AsNoTracking().SingleAsync(s => s.Id == target.Id, cancellationToken);
        session.EnsureInProgress();
        var item = await db.RegressionSessionItems.SingleAsync(i => i.Id == itemId, cancellationToken);
        return (session, item);
    }
}
