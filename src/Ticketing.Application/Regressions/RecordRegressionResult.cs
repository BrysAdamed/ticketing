using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Regressions;

namespace Ticketing.Application.Regressions;

/// <summary>
/// Records Passed, Failed (note required), Skipped or back to WaitingForExecution (spec 6.11, I-16). Only the assignee
/// records; an unassigned item is assigned to the caller first. Any result may change to any other while the session runs.
/// </summary>
public static class RecordRegressionResult
{
    public sealed record Command(
        RegressionItemStatus? Status,
        string? Note = null,
        [property: JsonIgnore] string SessionKeyOrId = "",
        [property: JsonIgnore] string Item = "") : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Must(Status is not null && Enum.IsDefined(Status.Value), "status", "status must be Passed, Failed, Skipped or WaitingForExecution.")
            .MaxLength("note", Note, RegressionSessionItem.ResultNoteMaxLength);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, RegressionItemChangeDto>
    {
        public async Task<RegressionItemChangeDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var target = await RegressionLookup.WriteAsync(db, access, command.SessionKeyOrId, cancellationToken);
            var itemId = await RegressionLookup.ItemIdAsync(db, target, command.Item, cancellationToken);
            await db.InTransactionAsync(
                async ct =>
                {
                    var (_, item) = await RegressionItemWrites.LoadForUpdateAsync(db, target, itemId, ct);
                    var (previousStatus, previousAssignee) = (item.Status, item.AssigneeId);
                    item.RecordResult(command.Status!.Value, command.Note, currentUser.Id, clock.Now);
                    if (previousAssignee != item.AssigneeId)
                        activity.Record(ActivityEntityType.RegressionSession, target.Id, target.ProjectId, "regression.item.assigned",
                            new { testCaseKey = item.TestCaseKey, from = previousAssignee, to = item.AssigneeId });
                    activity.Record(ActivityEntityType.RegressionSession, target.Id, target.ProjectId, "regression.item.result",
                        new { testCaseKey = item.TestCaseKey, from = previousStatus, to = item.Status, note = item.ResultNote });
                    return await db.SaveChangesAsync(ct);
                },
                cancellationToken);
            return await RegressionQueries.ItemChangeAsync(db, target, itemId, cancellationToken);
        }
    }
}
