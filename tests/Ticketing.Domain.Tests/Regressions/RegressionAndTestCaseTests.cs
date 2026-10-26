using Ticketing.Domain.Common;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;

namespace Ticketing.Domain.Tests.Regressions;

public sealed class RegressionAndTestCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 2, 8, 30, 0, TimeSpan.Zero);
    private static readonly Guid ProjectId = Guid.CreateVersion7();
    private static readonly Guid Actor = Guid.CreateVersion7();

    [Fact]
    public void Manual_test_case_needs_at_least_one_step()
    {
        // Arrange
        var testCase = TestCase.Create(ProjectId, 1, "Log in", Actor, Now);

        // Act
        var error = Assert.Throws<DomainException>(() => testCase.ChangeStatus(TestCaseStatus.Manual));

        // Assert
        Assert.Equal("testCase.manualRequiresSteps", error.Code);
    }

    [Fact]
    public void Manual_test_case_cannot_drop_its_last_step()
    {
        // Arrange
        var testCase = TestCase.Create(ProjectId, 1, "Log in", Actor, Now);
        testCase.ChangeStepsAndStatus(["Open the page"], TestCaseStatus.Manual);

        // Act / Assert
        Assert.Throws<DomainException>(() => testCase.ReplaceSteps([]));
        testCase.ChangeStepsAndStatus([], TestCaseStatus.Automatic);
        Assert.Equal(TestCaseStatus.Automatic, testCase.Status);
    }

    [Fact]
    public void Start_snapshots_eligible_cases_in_number_order()
    {
        // Arrange
        var automatic = Case(3, TestCaseStatus.Automatic);
        var manual = Case(1, TestCaseStatus.Manual);
        var newCase = Case(2, TestCaseStatus.New);
        var archived = Case(4, TestCaseStatus.Manual);
        archived.Archive(Actor, Now);

        // Act
        var session = RegressionSession.Start(ProjectId, "WEB", 3, null, "1.4.0", [automatic, newCase, archived, manual], Actor, Now);

        // Assert
        Assert.Equal("Regression 2026-11-02", session.Name);
        Assert.Equal("WEB-R-3", session.KeyIn("WEB"));
        Assert.Equal(["WEB-TC-1", "WEB-TC-3"], session.Items.Select(i => i.TestCaseKey));
        var (manualItem, autoItem) = (session.Items[0], session.Items[1]);
        Assert.Equal((RegressionItemStatus.WaitingForExecution, ExecutionMode.Manual, (DateTimeOffset?)null), (manualItem.Status, manualItem.ExecutionMode, manualItem.ExecutedAt));
        Assert.Equal((RegressionItemStatus.Passed, ExecutionMode.Automatic, (DateTimeOffset?)Now, (Guid?)null), (autoItem.Status, autoItem.ExecutionMode, autoItem.ExecutedAt, autoItem.ExecutedById));
        Assert.True(autoItem.IsAutoPassed);
    }

    [Fact]
    public void Snapshot_does_not_follow_later_test_case_edits()
    {
        // Arrange
        var manual = Case(1, TestCaseStatus.Manual);
        var session = RegressionSession.Start(ProjectId, "WEB", 1, null, null, [manual], Actor, Now);

        // Act
        manual.Rename("Renamed");
        manual.ReplaceSteps(["Different step"]);

        // Assert
        Assert.Equal("Log in 1", session.Items[0].Title);
        Assert.Equal(["Step one"], session.Items[0].Steps);
    }

    [Fact]
    public void Start_without_eligible_cases_fails()
    {
        // Act
        var error = Assert.Throws<DomainException>(() => RegressionSession.Start(ProjectId, "WEB", 1, null, null, [Case(1, TestCaseStatus.New)], Actor, Now));

        // Assert
        Assert.Equal(RegressionErrors.NoEligibleCases, error.Code);
    }

    [Fact]
    public void Recording_on_an_unassigned_item_assigns_the_actor_and_failed_needs_a_note()
    {
        // Arrange
        var session = RegressionSession.Start(ProjectId, "WEB", 1, null, null, [Case(1, TestCaseStatus.Manual)], Actor, Now);
        var item = session.Items[0];

        // Act
        var missingNote = Assert.Throws<DomainException>(() => item.RecordResult(RegressionItemStatus.Failed, " ", Actor, Now));
        item.RecordResult(RegressionItemStatus.Failed, "Button does nothing", Actor, Now);

        // Assert
        Assert.Equal(RegressionErrors.NoteRequired, missingNote.Code);
        Assert.Equal((Actor, RegressionItemStatus.Failed), (item.AssigneeId!.Value, item.Status));
        var other = Guid.CreateVersion7();
        Assert.Equal(DomainErrorKind.Forbidden, Assert.Throws<DomainException>(() => item.RecordResult(RegressionItemStatus.Passed, null, other, Now)).Kind);
    }

    [Fact]
    public void Complete_requires_no_waiting_items_unless_skipping_remaining()
    {
        // Arrange
        var session = RegressionSession.Start(ProjectId, "WEB", 1, null, null, [Case(1, TestCaseStatus.Manual), Case(2, TestCaseStatus.Automatic)], Actor, Now);

        // Act
        var error = Assert.Throws<DomainException>(() => session.Complete(skipRemaining: false, Actor, Now));
        session.Complete(skipRemaining: true, Actor, Now);

        // Assert
        Assert.Equal(RegressionErrors.HasWaitingItems, error.Code);
        Assert.Equal(RegressionSessionStatus.Completed, session.Status);
        Assert.Equal(RegressionSession.SkippedAtCompletionNote, session.Items[0].ResultNote);
        var summary = session.Summarize();
        Assert.Equal((2, 0, 1, 1, 1.0), (summary.Total, summary.PassedManual, summary.PassedAutomatic, summary.Skipped, summary.PassRate!.Value));
        Assert.Throws<DomainException>(() => session.Cancel(Actor, Now));
    }

    private static TestCase Case(int number, TestCaseStatus status)
    {
        var testCase = TestCase.Create(ProjectId, number, $"Log in {number}", Actor, Now);
        testCase.ChangeStepsAndStatus(["Step one"], status);
        return testCase;
    }
}
