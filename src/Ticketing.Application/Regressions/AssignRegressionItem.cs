using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.Regressions;

/// <summary>Owners assign an item to any active user with write access to the project, or unassign it with null (spec 5.3, 6.11).</summary>
public static class AssignRegressionItem
{
    /// <param name="Assignee">Email, user id or <c>me</c>; null unassigns.</param>
    public sealed record Command(
        string? Assignee,
        [property: JsonIgnore] string SessionKeyOrId = "",
        [property: JsonIgnore] string Item = "");

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IActivityLog activity)
        : IHandler<Command, RegressionItemChangeDto>
    {
        public async Task<RegressionItemChangeDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await RegressionLookup.ReadAsync(db, access, command.SessionKeyOrId, cancellationToken);
            target = target with { Grant = await access.EnsureOwnerAsync(target.ProjectId, cancellationToken) };
            var itemId = await RegressionLookup.ItemIdAsync(db, target, command.Item, cancellationToken);
            var assigneeId = string.IsNullOrWhiteSpace(command.Assignee)
                ? (Guid?)null
                : await RegressionUsers.AssigneeAsync(db, currentUser, target.Grant, command.Assignee, cancellationToken);

            await db.InTransactionAsync(
                async ct =>
                {
                    var (_, item) = await RegressionItemWrites.LoadForUpdateAsync(db, target, itemId, ct);
                    var previous = item.AssigneeId;
                    item.AssignTo(assigneeId);
                    if (previous != item.AssigneeId)
                        activity.Record(ActivityEntityType.RegressionSession, target.Id, target.ProjectId, "regression.item.assigned",
                            new { testCaseKey = item.TestCaseKey, from = previous, to = item.AssigneeId });
                    return await db.SaveChangesAsync(ct);
                },
                cancellationToken);
            return await RegressionQueries.ItemChangeAsync(db, target, itemId, cancellationToken);
        }
    }
}
