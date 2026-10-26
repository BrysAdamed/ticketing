using Ticketing.Domain.Common;
using Ticketing.Domain.TestCases;

namespace Ticketing.Domain.Regressions;

public sealed class RegressionSessionItem
{
    public const int ResultNoteMaxLength = 4000;

    private RegressionSessionItem()
    {
        TestCaseKey = null!;
        Title = null!;
        Steps = [];
    }

    public Guid Id { get; private set; }

    public Guid SessionId { get; private set; }

    public Guid TestCaseId { get; private set; }

    public int Order { get; private set; }

    public string TestCaseKey { get; private set; }

    public string Title { get; private set; }

    public string? Preconditions { get; private set; }

    public List<string> Steps { get; private set; }

    public string? ExpectedResult { get; private set; }

    public string? AutomationReference { get; private set; }

    public ExecutionMode ExecutionMode { get; private set; }

    public RegressionItemStatus Status { get; private set; }

    public Guid? AssigneeId { get; private set; }

    public string? ResultNote { get; private set; }

    public DateTimeOffset? ExecutedAt { get; private set; }

    public Guid? ExecutedById { get; private set; }

    public Guid? BugTicketId { get; private set; }

    public uint RowVersion { get; private set; }

    internal static RegressionSessionItem Snapshot(Guid sessionId, TestCase testCase, string projectKey, int order, DateTimeOffset startedAt)
    {
        var automatic = testCase.Status == TestCaseStatus.Automatic;
        return new RegressionSessionItem
        {
            Id = EntityId.New(),
            SessionId = sessionId,
            TestCaseId = testCase.Id,
            Order = order,
            TestCaseKey = testCase.KeyIn(projectKey),
            Title = testCase.Title,
            Preconditions = testCase.Preconditions,
            Steps = [.. testCase.Steps],
            ExpectedResult = testCase.ExpectedResult,
            AutomationReference = testCase.AutomationReference,
            ExecutionMode = automatic ? ExecutionMode.Automatic : ExecutionMode.Manual,
            Status = automatic ? RegressionItemStatus.Passed : RegressionItemStatus.WaitingForExecution,
            ExecutedAt = automatic ? startedAt : null,
        };
    }

    public bool IsAutoPassed => ExecutionMode == ExecutionMode.Automatic && Status == RegressionItemStatus.Passed && ExecutedById is null;

    /// <summary>Assigns the item to the actor, also taking it over from another assignee (D-23).</summary>
    public void Take(Guid actorId) => AssigneeId = actorId;

    /// <summary>Owner-only in the application layer: assign to someone else or unassign.</summary>
    public void AssignTo(Guid? assigneeId) => AssigneeId = assigneeId;

    public void RecordResult(RegressionItemStatus status, string? note, Guid actorId, DateTimeOffset now)
    {
        if (AssigneeId is null)
            AssigneeId = actorId;
        else if (AssigneeId != actorId)
            throw DomainException.Forbidden(RegressionErrors.NotAssignee, "Only the current assignee can record a result.");

        var normalizedNote = Text.Optional(note, "note", ResultNoteMaxLength);
        if (status == RegressionItemStatus.Failed && normalizedNote is null)
            throw DomainException.Invalid("note", RegressionErrors.NoteRequired, "A failed result needs a note describing the actual result.");

        Status = status;
        ResultNote = normalizedNote;
        ExecutedAt = now;
        ExecutedById = actorId;
    }

    public void AttachBug(Guid bugTicketId)
    {
        if (BugTicketId is not null)
            throw DomainException.Conflict(RegressionErrors.BugExists, "A bug was already created from this item.");
        if (Status != RegressionItemStatus.Failed)
            throw DomainException.Conflict(RegressionErrors.BugRequiresFailure, "Bugs can only be created from failed items.");
        BugTicketId = bugTicketId;
    }

    internal void SkipAtCompletion(Guid actorId, DateTimeOffset now)
    {
        Status = RegressionItemStatus.Skipped;
        ResultNote = RegressionSession.SkippedAtCompletionNote;
        ExecutedAt = now;
        ExecutedById = actorId;
    }
}
