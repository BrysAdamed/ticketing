using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.TestCases;

namespace Ticketing.Application.TestCases;

/// <summary>Creates a test case (spec 4.9, 6.10) with the next <c>KEY-TC-n</c> number, optionally linked to a ticket of the same project.</summary>
public static class CreateTestCase
{
    public sealed record Command(
        string Title,
        string? Preconditions = null,
        IReadOnlyList<string>? Steps = null,
        string? ExpectedResult = null,
        TestCaseStatus? Status = null,
        string? AutomationReference = null,
        string? TicketKey = null,
        [property: JsonIgnore] string ProjectKeyOrId = "",
        [property: JsonIgnore] string? IdempotencyKey = null) : IValidatable
    {
        public void Validate(Validator validator)
        {
            validator
                .Required("title", Title, TestCase.TitleMaxLength)
                .MaxLength("preconditions", Preconditions, TestCase.PreconditionsMaxLength)
                .MaxLength("expectedResult", ExpectedResult, TestCase.ExpectedResultMaxLength)
                .MaxLength("automationReference", AutomationReference, TestCase.AutomationReferenceMaxLength)
                .Must(Status is null || Enum.IsDefined(Status.Value), "status", "status must be New, Manual or Automatic.");
            TestCaseValidation.Steps(validator, Steps);
        }
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        IProjectCounters counters,
        IIdempotency idempotency) : IHandler<Command, TestCaseDto>
    {
        public async Task<TestCaseDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var grant = await access.EnsureCanWriteAsync(command.ProjectKeyOrId, cancellationToken);
            return await idempotency.ExecuteAsync(
                command.IdempotencyKey, "testCases.create", command with { IdempotencyKey = null, ProjectKeyOrId = grant.ProjectId.ToString() },
                ct => CreateAsync(grant, command, ct), cancellationToken);
        }

        private async Task<TestCaseDto> CreateAsync(ProjectAccessGrant grant, Command command, CancellationToken cancellationToken)
        {
            var ticketId = await TestCaseQueries.LinkedTicketAsync(db, grant, command.TicketKey, cancellationToken);
            var testCase = await db.InTransactionAsync(
                async ct =>
                {
                    var number = await counters.NextAsync(grant.ProjectId, CounterKind.TestCase, ct);
                    var created = TestCase.Create(grant.ProjectId, number, command.Title, currentUser.Id, clock.Now);
                    created.ChangePreconditions(command.Preconditions);
                    created.ChangeExpectedResult(command.ExpectedResult);
                    created.ChangeAutomationReference(command.AutomationReference);
                    created.ChangeStepsAndStatus(command.Steps ?? [], command.Status ?? TestCaseStatus.New);
                    created.LinkTicket(ticketId);

                    db.TestCases.Add(created);
                    activity.Record(ActivityEntityType.TestCase, created.Id, grant.ProjectId, "testCase.created", new
                    {
                        key = HumanKeys.TestCase(grant.ProjectKey, number),
                        created.Title,
                        created.Status,
                        stepCount = created.Steps.Count,
                        created.TicketId,
                    });
                    await db.SaveChangesAsync(ct);
                    return created;
                },
                cancellationToken);

            return await TestCaseQueries.LoadAsync(db, currentUser, new TestCaseTarget(testCase.Id, grant.ProjectId, testCase.Number, grant), cancellationToken);
        }
    }
}

internal static class TestCaseValidation
{
    public static void Steps(Validator validator, IReadOnlyList<string>? steps)
    {
        if (steps is null)
            return;
        validator.Must(steps.Count <= TestCase.MaxSteps, "steps", $"A test case can have at most {TestCase.MaxSteps} steps.");
        for (var i = 0; i < steps.Count; i++)
        {
            validator
                .Required($"steps[{i}]", steps[i], TestCase.StepMaxLength);
        }
    }
}
