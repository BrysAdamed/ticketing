using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.TestCases;

namespace Ticketing.Application.TestCases;

/// <summary>
/// PATCH of a test case (spec 6.10): omitted fields stay, null clears, steps replace the whole list, <c>archived</c>
/// archives or unarchives. Steps and status are applied together so the Manual-needs-steps rule sees the final state.
/// Running and completed sessions are unaffected (they hold snapshots).
/// </summary>
public static class UpdateTestCase
{
    private const string FieldChanged = "testCase.field.changed";

    public sealed record Command : IValidatable
    {
        [JsonIgnore]
        public string KeyOrId { get; init; } = string.Empty;

        public Optional<string> Title { get; init; }

        public Optional<string?> Preconditions { get; init; }

        public Optional<IReadOnlyList<string>> Steps { get; init; }

        public Optional<string?> ExpectedResult { get; init; }

        public Optional<TestCaseStatus> Status { get; init; }

        public Optional<string?> AutomationReference { get; init; }

        /// <summary>Ticket key or id; null clears the link.</summary>
        public Optional<string?> TicketKey { get; init; }

        public Optional<bool> Archived { get; init; }

        [JsonIgnore]
        public uint? ExpectedVersion { get; init; }

        public void Validate(Validator validator)
        {
            if (Title.HasValue)
                validator.Required("title", Title.Value, TestCase.TitleMaxLength);
            if (Preconditions.HasValue)
                validator.MaxLength("preconditions", Preconditions.Value, TestCase.PreconditionsMaxLength);
            if (ExpectedResult.HasValue)
                validator.MaxLength("expectedResult", ExpectedResult.Value, TestCase.ExpectedResultMaxLength);
            if (AutomationReference.HasValue)
                validator.MaxLength("automationReference", AutomationReference.Value, TestCase.AutomationReferenceMaxLength);
            if (Steps.HasValue)
            {
                validator.Must(Steps.Value is not null, "steps", "steps must be a list; send [] to remove all steps.");
                TestCaseValidation.Steps(validator, Steps.Value);
            }
            if (Status.HasValue)
                validator.Must(Enum.IsDefined(Status.Value), "status", "status must be New, Manual or Automatic.");
        }
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity) : IHandler<Command, TestCaseDto>
    {
        public async Task<TestCaseDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var target = await TestCaseLookup.WriteAsync(db, access, command.KeyOrId, cancellationToken);
            var testCase = await db.TestCases.SingleAsync(c => c.Id == target.Id, cancellationToken);
            db.ExpectVersion(testCase, command.ExpectedVersion);
            var projectId = target.ProjectId;

            void Changed<T>(string field, T oldValue, T newValue) =>
                activity.RecordChange(ActivityEntityType.TestCase, testCase.Id, projectId, FieldChanged, field, oldValue, newValue);

            if (command.Title.HasValue)
            {
                var old = testCase.Title;
                testCase.Rename(command.Title.Value);
                Changed("title", old, testCase.Title);
            }

            if (command.Preconditions.HasValue)
            {
                var old = testCase.Preconditions;
                testCase.ChangePreconditions(command.Preconditions.Value);
                Changed("preconditions", old, testCase.Preconditions);
            }

            if (command.ExpectedResult.HasValue)
            {
                var old = testCase.ExpectedResult;
                testCase.ChangeExpectedResult(command.ExpectedResult.Value);
                Changed("expectedResult", old, testCase.ExpectedResult);
            }

            if (command.AutomationReference.HasValue)
            {
                var old = testCase.AutomationReference;
                testCase.ChangeAutomationReference(command.AutomationReference.Value);
                Changed("automationReference", old, testCase.AutomationReference);
            }

            if (command.Steps.HasValue || command.Status.HasValue)
            {
                var (oldSteps, oldStatus) = (testCase.Steps.ToList(), testCase.Status);
                testCase.ChangeStepsAndStatus(command.Steps.GetValueOrDefault(testCase.Steps)!, command.Status.GetValueOrDefault(testCase.Status));
                Changed("steps", oldSteps, testCase.Steps);
                Changed("status", oldStatus, testCase.Status);
            }

            if (command.TicketKey.HasValue)
            {
                var old = testCase.TicketId;
                testCase.LinkTicket(await TestCaseQueries.LinkedTicketAsync(db, target.Grant, command.TicketKey.Value, cancellationToken));
                Changed("ticketId", old, testCase.TicketId);
            }

            if (command.Archived.HasValue && command.Archived.Value != testCase.IsArchived)
            {
                if (command.Archived.Value)
                    testCase.Archive(currentUser.Id, clock.Now);
                else
                    testCase.Unarchive();
                activity.Record(ActivityEntityType.TestCase, testCase.Id, projectId, command.Archived.Value ? "testCase.archived" : "testCase.unarchived");
            }

            if (db.Entry(testCase).State == EntityState.Modified)
                testCase.Touch(clock.Now);
            await db.SaveChangesAsync(cancellationToken);
            return await TestCaseQueries.LoadAsync(db, currentUser, target, cancellationToken);
        }
    }
}
