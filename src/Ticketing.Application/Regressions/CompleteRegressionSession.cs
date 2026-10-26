using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Regressions;

namespace Ticketing.Application.Regressions;

/// <summary>
/// Completes a session (spec 6.11, D-25) when no item is waiting, or with <c>skipRemaining</c> after marking every waiting
/// item Skipped with the note "Skipped at completion". The session and its items are immutable afterwards.
/// </summary>
public static class CompleteRegressionSession
{
    public sealed record Command(bool SkipRemaining = false, [property: JsonIgnore] string SessionKeyOrId = "");

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, RegressionSessionSummaryDto>
    {
        public async Task<RegressionSessionSummaryDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await RegressionLookup.WriteAsync(db, access, command.SessionKeyOrId, cancellationToken);
            await db.InTransactionAsync(
                async ct =>
                {
                    await RegressionLocks.ExclusiveAsync(db, target.Id, ct);
                    var session = await db.RegressionSessions.Include(s => s.Items).SingleAsync(s => s.Id == target.Id, ct);
                    var waiting = session.Items.Count(i => i.Status == RegressionItemStatus.WaitingForExecution);
                    session.Complete(command.SkipRemaining, currentUser.Id, clock.Now);
                    activity.Record(ActivityEntityType.RegressionSession, session.Id, session.ProjectId, "regression.completed",
                        new { key = target.Key, skippedRemaining = waiting, summary = RegressionSummaryDto.From(session.Summarize()) });
                    return await db.SaveChangesAsync(ct);
                },
                cancellationToken);
            return await RegressionQueries.SessionSummaryAsync(db, target, cancellationToken);
        }
    }
}
