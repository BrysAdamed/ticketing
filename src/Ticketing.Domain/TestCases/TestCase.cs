using Ticketing.Domain.Common;

namespace Ticketing.Domain.TestCases;

public sealed class TestCase
{
    public const int TitleMaxLength = 200;
    public const int PreconditionsMaxLength = 4000;
    public const int ExpectedResultMaxLength = 4000;
    public const int StepMaxLength = 1000;
    public const int MaxSteps = 50;
    public const int AutomationReferenceMaxLength = 500;

    private TestCase()
    {
        Title = null!;
        Steps = [];
    }

    public Guid Id { get; private set; }

    public Guid ProjectId { get; private set; }

    public int Number { get; private set; }

    public string Title { get; private set; }

    public string? Preconditions { get; private set; }

    public List<string> Steps { get; private set; }

    public string? ExpectedResult { get; private set; }

    public TestCaseStatus Status { get; private set; }

    public string? AutomationReference { get; private set; }

    public Guid? TicketId { get; private set; }

    public DateTimeOffset? ArchivedAt { get; private set; }

    public Guid? ArchivedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public Guid CreatedById { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public uint RowVersion { get; private set; }

    public bool IsArchived => ArchivedAt is not null;

    public bool IsEligibleForRegression => !IsArchived && Status is TestCaseStatus.Manual or TestCaseStatus.Automatic;

    public static TestCase Create(Guid projectId, int number, string title, Guid createdById, DateTimeOffset now) => new()
    {
        Id = EntityId.New(),
        ProjectId = projectId,
        Number = number,
        Title = Text.SingleLine(title, "title", TitleMaxLength),
        Steps = [],
        Status = TestCaseStatus.New,
        CreatedAt = now,
        CreatedById = createdById,
        UpdatedAt = now,
    };

    public string KeyIn(string projectKey) => HumanKeys.TestCase(projectKey, Number);

    public void Rename(string title) => Title = Text.SingleLine(title, "title", TitleMaxLength);

    public void ChangePreconditions(string? preconditions) =>
        Preconditions = Text.Optional(preconditions, "preconditions", PreconditionsMaxLength);

    public void ChangeExpectedResult(string? expectedResult) =>
        ExpectedResult = Text.Optional(expectedResult, "expectedResult", ExpectedResultMaxLength);

    public void ChangeAutomationReference(string? reference) =>
        AutomationReference = Text.Optional(reference, "automationReference", AutomationReferenceMaxLength);

    public void LinkTicket(Guid? ticketId) => TicketId = ticketId;

    /// <summary>Replaces steps and status together so the Manual-needs-steps rule is checked against the final state.</summary>
    public void ChangeStepsAndStatus(IEnumerable<string?> steps, TestCaseStatus status)
    {
        var normalized = NormalizeSteps(steps);
        EnsureStepsForStatus(normalized, status);
        Steps = normalized;
        Status = status;
    }

    public void ReplaceSteps(IEnumerable<string?> steps) => ChangeStepsAndStatus(steps, Status);

    public void ChangeStatus(TestCaseStatus status) => ChangeStepsAndStatus(Steps, status);

    public void Archive(Guid actorId, DateTimeOffset now)
    {
        if (IsArchived)
            return;
        ArchivedAt = now;
        ArchivedById = actorId;
    }

    public void Unarchive()
    {
        ArchivedAt = null;
        ArchivedById = null;
    }

    public void Touch(DateTimeOffset now) => UpdatedAt = now;

    private static List<string> NormalizeSteps(IEnumerable<string?> steps)
    {
        var result = new List<string>();
        foreach (var step in steps)
            result.Add(Text.Required(step, "steps", StepMaxLength));
        if (result.Count > MaxSteps)
            throw DomainException.Invalid("steps", TestCaseErrors.TooManySteps, $"A test case can have at most {MaxSteps} steps.");
        return result;
    }

    private static void EnsureStepsForStatus(List<string> steps, TestCaseStatus status)
    {
        if (status == TestCaseStatus.Manual && steps.Count == 0)
            throw DomainException.Invalid(
                "steps", TestCaseErrors.ManualRequiresSteps, "A Manual test case needs at least one step.", "Add steps or keep the status New.");
    }
}
