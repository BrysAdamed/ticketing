using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Tests.Regressions;

public sealed class RegressionBugTemplateTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 2, 8, 30, 0, TimeSpan.Zero);
    private static readonly Guid ProjectId = Guid.CreateVersion7();
    private static readonly Guid Actor = Guid.CreateVersion7();

    [Fact]
    public void Draft_follows_the_spec_template()
    {
        // Arrange
        var testCase = TestCase.Create(ProjectId, 7, "Log in with valid credentials", Actor, Now);
        testCase.ChangePreconditions("A registered user");
        testCase.ChangeExpectedResult("The dashboard opens");
        testCase.ChangeStepsAndStatus(["Open the login page", "Enter valid credentials\nand press Enter"], TestCaseStatus.Manual);
        var session = RegressionSession.Start(ProjectId, "WEB", 3, null, "1.4.0", [testCase], Actor, Now);
        var item = session.Items[0];
        item.RecordResult(RegressionItemStatus.Failed, "The button does nothing", Actor, Now);

        // Act
        var draft = RegressionBugTemplate.Draft(session, "WEB", item, "Jane Doe", Now);

        // Assert
        Assert.Equal("[Regression] Log in with valid credentials", draft.Title);
        Assert.Equal(
            """
            Found in regression session WEB-R-3 "Regression 2026-11-02" (version 1.4.0) by Jane Doe on 2026-11-02.
            Test case: WEB-TC-7 "Log in with valid credentials"

            ## Preconditions
            A registered user

            ## Steps to reproduce
            1. Open the login page
            2. Enter valid credentials
               and press Enter

            ## Expected result
            The dashboard opens

            ## Actual result
            The button does nothing
            """.ReplaceLineEndings("\n"),
            draft.Description);
        Assert.Equal((Severity.Major, Priority.High, "1.4.0"), (draft.Severity, draft.Priority, draft.Version));
        Assert.Equal(["regression"], draft.Labels);
    }

    [Fact]
    public void Draft_without_version_preconditions_or_expected_result_uses_placeholders()
    {
        // Arrange
        var testCase = TestCase.Create(ProjectId, 1, "Export", Actor, Now);
        testCase.ChangeStepsAndStatus(["Click export"], TestCaseStatus.Manual);
        var session = RegressionSession.Start(ProjectId, "WEB", 1, "Smoke", null, [testCase], Actor, Now);
        var item = session.Items[0];
        item.RecordResult(RegressionItemStatus.Failed, "Nothing happens", Actor, Now);

        // Act
        var draft = RegressionBugTemplate.Draft(session, "WEB", item, "Jane Doe", Now);

        // Assert
        Assert.StartsWith("Found in regression session WEB-R-1 \"Smoke\" by Jane Doe on 2026-11-02.\n", draft.Description, StringComparison.Ordinal);
        Assert.Contains("## Preconditions\nNone\n", draft.Description, StringComparison.Ordinal);
        Assert.Contains("## Expected result\nNot specified\n", draft.Description, StringComparison.Ordinal);
        Assert.Null(draft.Version);
    }

    [Fact]
    public void Draft_title_fits_the_ticket_title_limit()
    {
        // Arrange
        var testCase = TestCase.Create(ProjectId, 1, new string('x', TestCase.TitleMaxLength), Actor, Now);
        testCase.ChangeStepsAndStatus(["Step"], TestCaseStatus.Automatic);
        var session = RegressionSession.Start(ProjectId, "WEB", 1, null, null, [testCase], Actor, Now);
        var item = session.Items[0];
        item.RecordResult(RegressionItemStatus.Failed, "Broken", Actor, Now);

        // Act
        var draft = RegressionBugTemplate.Draft(session, "WEB", item, "Jane Doe", Now);

        // Assert
        Assert.True(draft.Title.Length <= Ticket.TitleMaxLength);
        Assert.StartsWith(RegressionBugTemplate.TitlePrefix, draft.Title, StringComparison.Ordinal);
    }
}
