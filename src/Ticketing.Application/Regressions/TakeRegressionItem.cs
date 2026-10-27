using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.Regressions;

/// <summary>Assigns an item to the caller, also taking it over from another assignee (spec 6.11, D-23; the UI confirms a take-over).</summary>
public static class TakeRegressionItem
{
    public sealed record Command(string SessionKeyOrId, string Item);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IActivityLog activity)
        : IHandler<Command, RegressionItemChangeDto>
    {
        public async Task<RegressionItemChangeDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await RegressionLookup.WriteAsync(db, access, command.SessionKeyOrId, cancellationToken);
            var itemId = await RegressionLookup.ItemIdAsync(db, target, command.Item, cancellationToken);
            await db.InTransactionAsync(
                async ct =>
                {
                    var (_, item) = await RegressionItemWrites.LoadForUpdateAsync(db, target, itemId, ct);
                    var previous = item.AssigneeId;
                    item.Take(currentUser.Id);
                    if (previous != item.AssigneeId)
                        activity.Record(ActivityEntityType.RegressionSession, target.Id, target.ProjectId, RegressionItemWrites.AssignedAction,
                            new { testCaseKey = item.TestCaseKey, from = previous, to = item.AssigneeId, takeOver = previous is not null });
                    return await db.SaveChangesAsync(ct);
                },
                cancellationToken);
            return await RegressionQueries.ItemChangeAsync(db, target, itemId, cancellationToken);
        }
    }
}
