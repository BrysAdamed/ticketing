using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Regressions;

namespace Ticketing.Application.Regressions;

/// <summary>Cancels an in-progress session (Owner or the session starter, spec 5.3). Cancelled sessions are read-only and excluded from trends.</summary>
public static class CancelRegressionSession
{
    public sealed record Command(string SessionKeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, RegressionSessionSummaryDto>
    {
        public async Task<RegressionSessionSummaryDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await RegressionLookup.WriteAsync(db, access, command.SessionKeyOrId, cancellationToken);
            if (!target.Grant.IsOwner && target.StartedById != currentUser.Id)
                throw AppException.Forbidden(RegressionErrors.CancelForbidden, $"Only project owners or the person who started {target.Key} can cancel it.");

            await db.InTransactionAsync(
                async ct =>
                {
                    await RegressionLocks.ExclusiveAsync(db, target.Id, ct);
                    var session = await db.RegressionSessions.SingleAsync(s => s.Id == target.Id, ct);
                    session.Cancel(currentUser.Id, clock.Now);
                    activity.Record(ActivityEntityType.RegressionSession, session.Id, session.ProjectId, "regression.cancelled", new { key = target.Key });
                    return await db.SaveChangesAsync(ct);
                },
                cancellationToken);
            return await RegressionQueries.SessionSummaryAsync(db, target, cancellationToken);
        }
    }
}
