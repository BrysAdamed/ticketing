using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Application.Regressions;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Testing;

[Collection(nameof(TestingCollection))]
public sealed class RegressionEndpointTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Start_snapshots_eligible_cases_and_auto_passes_automatic_ones()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        await client.CreateProjectAsync("WEB");
        await client.CreateManualCaseAsync("WEB", "Login");
        await client.CreateTestCaseAsync("WEB", "Not ready");
        await client.CreateAutomaticCaseAsync("WEB", "Logout");
        var archived = await client.CreateManualCaseAsync("WEB", "Legacy");
        await client.PatchAsJsonAsync($"/api/v1/test-cases/{archived.Key}", new { archived = true }, _ct);

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/projects/WEB/regression-sessions", new { version = "1.4.0" }, _ct);
        await client.PatchAsJsonAsync("/api/v1/test-cases/WEB-TC-1", new { title = "Login renamed" }, _ct);
        var fetched = await client.GetSessionAsync("web-r-1");

        // Assert
        var session = await response.ReadAsync<RegressionSessionDto>(HttpStatusCode.Created);
        Assert.Equal("/api/v1/regression-sessions/WEB-R-1", response.Headers.Location?.OriginalString);
        Assert.Equal(("WEB-R-1", $"Regression {DateTimeOffset.UtcNow:yyyy-MM-dd}", "1.4.0", RegressionSessionStatus.InProgress),
            (session.Key, session.Name, session.Version, session.Status));
        Assert.Equal(["WEB-TC-1", "WEB-TC-3"], session.Items.Select(i => i.TestCaseKey));
        var (manual, automatic) = (session.Items[0], session.Items[1]);
        Assert.Equal((RegressionItemStatus.WaitingForExecution, ExecutionMode.Manual, false), (manual.Status, manual.ExecutionMode, manual.AutoPassed));
        Assert.Equal((RegressionItemStatus.Passed, true, session.StartedAt), (automatic.Status, automatic.AutoPassed, automatic.ExecutedAt!.Value));
        Assert.Null(automatic.ExecutedBy);
        Assert.Equal((2, 1, 1, 1, 1.0), (session.Summary.Total, session.Summary.Waiting, session.Summary.PassedAutomatic, session.Summary.Passed, session.Summary.PassRate!.Value));
        Assert.Equal("Login", fetched.Items[0].Title);
        Assert.Equal("/projects/WEB/regressions/WEB-R-1?item=WEB-TC-1", fetched.Items[0].Url);
        Assert.Equal(new RegressionPermissionsDto(true, true, true, true), fetched.Permissions);
    }

    [Fact]
    public async Task Start_without_eligible_cases_fails_and_consumes_no_number()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        await client.CreateTestCaseAsync("WEB", "Not ready");

        // Act
        var failed = await client.PostAsJsonAsync("/api/v1/projects/WEB/regression-sessions", new { }, _ct);
        await client.PatchAsJsonAsync("/api/v1/test-cases/WEB-TC-1", new { status = "Automatic" }, _ct);
        var started = await client.StartSessionAsync("WEB", new { name = "Smoke" });

        // Assert
        await failed.ShouldBeProblemAsync(HttpStatusCode.Conflict, RegressionErrors.NoEligibleCases);
        Assert.Equal(("WEB-R-1", "Smoke"), (started.Key, started.Name));
    }

    [Fact]
    public async Task Take_record_and_fail_follow_the_assignee_rules()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var tester = await api.CreateUserAsync();
        var other = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var testerClient = await api.LoginAsync(tester);
        var otherClient = await api.LoginAsync(other);
        var project = await ownerClient.CreateProjectAsync("WEB");
        await api.AddMemberAsync(project.Id, tester, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, other, ProjectRole.Member);
        await ownerClient.CreateManualCaseAsync("WEB", "Login");
        await ownerClient.CreateManualCaseAsync("WEB", "Export");
        await ownerClient.StartSessionAsync("WEB");

        // Act
        var taken = await (await testerClient.TakeAsync("WEB-R-1", "web-tc-1")).ReadAsync<RegressionItemChangeDto>();
        var notAssignee = await otherClient.RecordAsync("WEB-R-1", "WEB-TC-1", "Passed");
        var missingNote = await testerClient.RecordAsync("WEB-R-1", "WEB-TC-1", "Failed", "  ");
        var failed = await (await testerClient.RecordAsync("WEB-R-1", "WEB-TC-1", "Failed", "Button does nothing")).ReadAsync<RegressionItemChangeDto>();
        var autoAssigned = await (await otherClient.RecordAsync("WEB-R-1", "WEB-TC-2", "Skipped")).ReadAsync<RegressionItemChangeDto>();
        var takeOver = await (await otherClient.TakeAsync("WEB-R-1", "WEB-TC-1")).ReadAsync<RegressionItemChangeDto>();
        var backToWaiting = await (await otherClient.RecordAsync("WEB-R-1", "WEB-TC-1", "WaitingForExecution")).ReadAsync<RegressionItemChangeDto>();
        var unknownItem = await testerClient.TakeAsync("WEB-R-1", "WEB-TC-9");

        // Assert
        Assert.Equal(tester.Id, taken.Item.Assignee?.Id);
        await notAssignee.ShouldBeProblemAsync(HttpStatusCode.Forbidden, RegressionErrors.NotAssignee);
        await missingNote.ShouldBeProblemAsync(HttpStatusCode.BadRequest, RegressionErrors.NoteRequired);
        Assert.Equal((RegressionItemStatus.Failed, "Button does nothing", tester.Id), (failed.Item.Status, failed.Item.ResultNote, failed.Item.ExecutedBy!.Id));
        Assert.Equal((1, 0.0), (failed.Summary.Failed, failed.Summary.PassRate!.Value));
        Assert.Equal((other.Id, RegressionItemStatus.Skipped), (autoAssigned.Item.Assignee!.Id, autoAssigned.Item.Status));
        Assert.Equal(other.Id, takeOver.Item.Assignee?.Id);
        Assert.Equal((RegressionItemStatus.WaitingForExecution, 1), (backToWaiting.Item.Status, backToWaiting.Summary.Waiting));
        await unknownItem.ShouldBeProblemAsync(HttpStatusCode.NotFound, RegressionErrors.ItemNotFound);
        var actions = await api.WithDbAsync(db => db.ActivityEntries
            .Where(a => a.EntityType == ActivityEntityType.RegressionSession).Select(a => a.Action).ToListAsync(_ct));
        Assert.Equal(3, actions.Count(a => a == "regression.item.result"));
        Assert.Equal(3, actions.Count(a => a == "regression.item.assigned"));
    }

    [Fact]
    public async Task Owners_assign_to_writers_or_unassign_and_members_cannot()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var memberClient = await api.LoginAsync(member);
        var project = await ownerClient.CreateProjectAsync("WEB");
        await api.AddMemberAsync(project.Id, member, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, viewer, ProjectRole.Viewer);
        await ownerClient.CreateManualCaseAsync("WEB", "Login");
        await ownerClient.StartSessionAsync("WEB");
        const string assignUrl = "/api/v1/regression-sessions/WEB-R-1/items/WEB-TC-1/assign";

        // Act
        var assigned = await (await ownerClient.PostAsJsonAsync(assignUrl, new { assignee = member.Email.ToUpperInvariant() }, _ct)).ReadAsync<RegressionItemChangeDto>();
        var toViewer = await ownerClient.PostAsJsonAsync(assignUrl, new { assignee = viewer.Email }, _ct);
        var byMember = await memberClient.PostAsJsonAsync(assignUrl, new { assignee = (string?)null }, _ct);
        var unassigned = await (await ownerClient.PostAsJsonAsync(assignUrl, new { assignee = (string?)null }, _ct)).ReadAsync<RegressionItemChangeDto>();

        // Assert
        Assert.Equal(member.Id, assigned.Item.Assignee?.Id);
        await toViewer.ShouldBeProblemAsync(HttpStatusCode.BadRequest, RegressionErrors.AssigneeInvalid);
        await byMember.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        Assert.Null(unassigned.Item.Assignee);
    }

    [Fact]
    public async Task Get_filters_items_by_status_and_assignee_but_summarizes_the_whole_session()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("WEB");
        await client.CreateManualCaseAsync("WEB", "One");
        await client.CreateManualCaseAsync("WEB", "Two");
        await client.CreateAutomaticCaseAsync("WEB", "Three");
        await client.StartSessionAsync("WEB");
        await client.TakeAsync("WEB-R-1", "WEB-TC-2");

        // Act
        var mine = await client.GetSessionAsync("WEB-R-1?assignee=me");
        var unassigned = await client.GetSessionAsync("WEB-R-1?assignee=unassigned");
        var waiting = await client.GetSessionAsync("WEB-R-1?itemStatus=WaitingForExecution");
        var byEmail = await client.GetSessionAsync($"WEB-R-1?assignee={user.Email}&itemStatus=Passed");

        // Assert
        Assert.Equal(["WEB-TC-2"], mine.Items.Select(i => i.TestCaseKey));
        Assert.Equal(["WEB-TC-1", "WEB-TC-3"], unassigned.Items.Select(i => i.TestCaseKey));
        Assert.Equal(["WEB-TC-1", "WEB-TC-2"], waiting.Items.Select(i => i.TestCaseKey));
        Assert.Empty(byEmail.Items);
        Assert.Equal(3, mine.Summary.Total);
    }

    [Fact]
    public async Task Complete_requires_nothing_waiting_unless_skipping_and_freezes_the_session()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        await client.CreateManualCaseAsync("WEB", "One");
        await client.CreateManualCaseAsync("WEB", "Two");
        await client.StartSessionAsync("WEB");
        await client.RecordAsync("WEB-R-1", "WEB-TC-1", "Passed");

        // Act
        var blocked = await client.PostAsJsonAsync("/api/v1/regression-sessions/WEB-R-1/complete", new { }, _ct);
        var completed = await (await client.PostAsJsonAsync("/api/v1/regression-sessions/WEB-R-1/complete", new { skipRemaining = true }, _ct))
            .ReadAsync<RegressionSessionSummaryDto>();
        var afterwards = await client.RecordAsync("WEB-R-1", "WEB-TC-1", "Failed", "Too late");
        var cancelAfterwards = await client.PostAsync("/api/v1/regression-sessions/WEB-R-1/cancel", null, _ct);
        var session = await client.GetSessionAsync("WEB-R-1");

        // Assert
        await blocked.ShouldBeProblemAsync(HttpStatusCode.Conflict, RegressionErrors.HasWaitingItems);
        Assert.Equal(RegressionSessionStatus.Completed, completed.Status);
        Assert.NotNull(completed.CompletedAt);
        Assert.Equal((1, 1, 0, 1.0), (completed.Summary.Passed, completed.Summary.Skipped, completed.Summary.Waiting, completed.Summary.PassRate!.Value));
        await afterwards.ShouldBeProblemAsync(HttpStatusCode.Conflict, RegressionErrors.NotInProgress);
        await cancelAfterwards.ShouldBeProblemAsync(HttpStatusCode.Conflict, RegressionErrors.NotInProgress);
        Assert.Equal(RegressionSession.SkippedAtCompletionNote, session.Items[1].ResultNote);
        Assert.Equal(new RegressionPermissionsDto(false, false, false, false), session.Permissions);
    }

    [Fact]
    public async Task Cancel_is_for_owners_and_the_starter()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var starter = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var starterClient = await api.LoginAsync(starter);
        var memberClient = await api.LoginAsync(member);
        var project = await ownerClient.CreateProjectAsync("WEB");
        await api.AddMemberAsync(project.Id, starter, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, member, ProjectRole.Member);
        await ownerClient.CreateManualCaseAsync("WEB", "One");
        await starterClient.StartSessionAsync("WEB");
        await ownerClient.StartSessionAsync("WEB");

        // Act
        var byMember = await memberClient.PostAsync("/api/v1/regression-sessions/WEB-R-1/cancel", null, _ct);
        var byStarter = await starterClient.PostAsync("/api/v1/regression-sessions/WEB-R-1/cancel", null, _ct);
        var byOwner = await ownerClient.PostAsync("/api/v1/regression-sessions/WEB-R-2/cancel", null, _ct);

        // Assert
        await byMember.ShouldBeProblemAsync(HttpStatusCode.Forbidden, RegressionErrors.CancelForbidden);
        Assert.Equal(RegressionSessionStatus.Cancelled, (await byStarter.ReadAsync<RegressionSessionSummaryDto>()).Status);
        Assert.Equal(RegressionSessionStatus.Cancelled, (await byOwner.ReadAsync<RegressionSessionSummaryDto>()).Status);
    }

    [Fact]
    public async Task List_returns_sessions_newest_first_with_summaries()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        await client.CreateManualCaseAsync("WEB", "One");
        await client.CreateAutomaticCaseAsync("WEB", "Two");
        await client.StartSessionAsync("WEB");
        await client.StartSessionAsync("WEB");
        await client.StartSessionAsync("WEB");
        await client.RecordAsync("WEB-R-2", "WEB-TC-1", "Failed", "Broken");
        await client.PostAsync("/api/v1/regression-sessions/WEB-R-3/cancel", null, _ct);

        // Act
        var firstPage = await (await client.GetAsync("/api/v1/projects/WEB/regression-sessions?limit=2", _ct)).ReadAsync<CursorPage<RegressionSessionSummaryDto>>();
        var secondPage = await (await client.GetAsync($"/api/v1/projects/WEB/regression-sessions?limit=2&cursor={firstPage.NextCursor}", _ct))
            .ReadAsync<CursorPage<RegressionSessionSummaryDto>>();
        var inProgress = await (await client.GetAsync("/api/v1/projects/WEB/regression-sessions?status=InProgress", _ct))
            .ReadAsync<CursorPage<RegressionSessionSummaryDto>>();

        // Assert
        Assert.Equal(["WEB-R-3", "WEB-R-2"], firstPage.Items.Select(s => s.Key));
        Assert.Equal(["WEB-R-1"], secondPage.Items.Select(s => s.Key));
        var failedSession = firstPage.Items[1].Summary;
        Assert.Equal((2, 1, 1, 0.5), (failedSession.Total, failedSession.Failed, failedSession.PassedAutomatic, failedSession.PassRate!.Value));
        Assert.Equal(["WEB-R-2", "WEB-R-1"], inProgress.Items.Select(s => s.Key));
    }

    [Fact]
    public async Task Bug_draft_follows_the_template_for_failed_items_only()
    {
        // Arrange
        var user = await api.CreateUserAsync(displayName: "Jane Doe");
        var client = await api.LoginAsync(user);
        var project = await client.CreateProjectAsync("WEB");
        await client.CreateStoryAsync(project.Key);
        await client.CreateTestCaseAsync("WEB", "Log in", new
        {
            status = "Manual", steps = new[] { "Open login", "Submit" }, expectedResult = "Dashboard opens", ticketKey = "WEB-1",
        });
        await client.CreateManualCaseAsync("WEB", "Export");
        await client.StartSessionAsync("WEB", new { version = "1.4.0" });
        await client.RecordAsync("WEB-R-1", "WEB-TC-1", "Failed", "Nothing happens");

        // Act
        var draft = await (await client.GetAsync("/api/v1/regression-sessions/WEB-R-1/items/WEB-TC-1/bug-draft", _ct)).ReadAsync<RegressionBugDraftDto>();
        var notFailed = await client.GetAsync("/api/v1/regression-sessions/WEB-R-1/items/WEB-TC-2/bug-draft", _ct);

        // Assert
        Assert.Equal(("[Regression] Log in", TicketType.Bug, Severity.Major, Priority.High, "1.4.0"), (draft.Title, draft.Type, draft.Severity, draft.Priority, draft.Version));
        Assert.Equal(["regression"], draft.Labels);
        Assert.Equal("WEB-1", draft.RelatedTicket?.Key);
        Assert.StartsWith(
            $"Found in regression session WEB-R-1 \"Regression {DateTimeOffset.UtcNow:yyyy-MM-dd}\" (version 1.4.0) by Jane Doe on {DateTimeOffset.UtcNow:yyyy-MM-dd}.\nTest case: WEB-TC-1 \"Log in\"",
            draft.Description, StringComparison.Ordinal);
        Assert.Contains("## Steps to reproduce\n1. Open login\n2. Submit\n", draft.Description, StringComparison.Ordinal);
        Assert.EndsWith("## Actual result\nNothing happens", draft.Description, StringComparison.Ordinal);
        await notFailed.ShouldBeProblemAsync(HttpStatusCode.Conflict, RegressionErrors.BugRequiresFailure);
    }

    [Fact]
    public async Task Create_bug_puts_a_templated_bug_on_top_of_the_backlog_linked_to_the_ticket_once()
    {
        // Arrange
        var user = await api.CreateUserAsync(displayName: "Jane Doe");
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("WEB");
        var story = await client.CreateStoryAsync("WEB");
        await client.CreateStoryAsync("WEB", "Existing backlog item");
        await client.CreateTestCaseAsync("WEB", "Log in", new { status = "Manual", steps = new[] { "Open login", "Submit" }, ticketKey = story });
        await client.StartSessionAsync("WEB", new { version = "1.4.0" });
        await client.RecordAsync("WEB-R-1", "WEB-TC-1", "Failed", "Nothing happens");

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/regression-sessions/WEB-R-1/items/WEB-TC-1/bug", new { severity = "Critical" }, _ct);
        var again = await client.PostAsJsonAsync("/api/v1/regression-sessions/WEB-R-1/items/WEB-TC-1/bug", new { }, _ct);
        var draftAgain = await client.GetAsync("/api/v1/regression-sessions/WEB-R-1/items/WEB-TC-1/bug-draft", _ct);
        var bug = await (await client.GetAsync("/api/v1/tickets/WEB-3", _ct)).ReadAsync<TicketDto>();
        var backlog = await (await client.GetAsync("/api/v1/projects/WEB/backlog", _ct)).ReadAsync<JsonElement>();

        // Assert
        var change = await response.ReadAsync<RegressionItemChangeDto>(HttpStatusCode.Created);
        Assert.Equal("WEB-3", change.CreatedBug?.Key);
        Assert.Equal(("WEB-3", false), (change.Item.Bug?.Key, change.Item.Bug!.Deleted));
        Assert.Equal(1, change.Summary.BugsCreated);
        Assert.Equal(("[Regression] Log in", TicketType.Bug, Severity.Critical, Priority.High, "1.4.0"), (bug.Title, bug.Type, bug.Severity, bug.Priority, bug.Version));
        Assert.Equal(["regression"], bug.Labels);
        Assert.Equal((user.Id, (Guid?)null), (bug.Reporter.Id, bug.Assignee?.Id));
        Assert.Contains("## Steps to reproduce\n1. Open login\n2. Submit", bug.Description, StringComparison.Ordinal);
        Assert.Equal((TicketLinkType.RelatesTo, story), (Assert.Single(bug.Links!).Type, bug.Links![0].Ticket.Key));
        Assert.Equal("WEB-3", backlog.GetProperty("items")[0].GetProperty("key").GetString());
        await again.ShouldBeProblemAsync(HttpStatusCode.Conflict, RegressionErrors.BugExists);
        await draftAgain.ShouldBeProblemAsync(HttpStatusCode.Conflict, RegressionErrors.BugExists);
    }

    [Fact]
    public async Task Record_with_create_bug_is_all_or_nothing()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        await client.CreateManualCaseAsync("WEB", "Export");
        await client.StartSessionAsync("WEB");
        const string url = "/api/v1/regression-sessions/WEB-R-1/items/WEB-TC-1/result";

        // Act
        var passedWithBug = await client.PostAsJsonAsync(url, new { status = "Passed", createBug = true }, _ct);
        var badAssignee = await client.PostAsJsonAsync(url, new { status = "Failed", note = "Broken", createBug = true, bug = new { assignee = "nobody@x.test" } }, _ct);
        var afterFailure = await client.GetSessionAsync("WEB-R-1");
        var created = await (await client.PostAsJsonAsync(url, new { status = "Failed", note = "Broken", createBug = true, bug = new { title = "Export is broken" } }, _ct))
            .ReadAsync<RegressionItemChangeDto>();

        // Assert
        await passedWithBug.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        await badAssignee.ShouldHaveStatusAsync(HttpStatusCode.BadRequest);
        Assert.Equal(RegressionItemStatus.WaitingForExecution, afterFailure.Items[0].Status);
        Assert.Equal(("Export is broken", RegressionItemStatus.Failed), (created.CreatedBug?.Title, created.Item.Status));
        Assert.Equal(created.CreatedBug?.Key, created.Item.Bug?.Key);
    }

    [Fact]
    public async Task Viewers_read_but_cannot_execute_and_outsiders_see_nothing()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var viewerClient = await api.LoginAsync(viewer);
        var outsiderClient = await api.LoginAsync(outsider);
        var project = await ownerClient.CreateProjectAsync("WEB");
        await api.AddMemberAsync(project.Id, viewer, ProjectRole.Viewer);
        await ownerClient.CreateManualCaseAsync("WEB", "One");
        var session = await ownerClient.StartSessionAsync("WEB");

        // Act
        var viewerView = await viewerClient.GetSessionAsync("WEB-R-1");
        var viewerTake = await viewerClient.TakeAsync("WEB-R-1", "WEB-TC-1");
        var viewerStart = await viewerClient.PostAsJsonAsync("/api/v1/projects/WEB/regression-sessions", new { }, _ct);
        var outsiderGet = await outsiderClient.GetAsync("/api/v1/regression-sessions/WEB-R-1", _ct);
        var outsiderById = await outsiderClient.GetAsync($"/api/v1/regression-sessions/{session.Id}", _ct);
        var outsiderList = await outsiderClient.GetAsync("/api/v1/projects/WEB/regression-sessions", _ct);
        var outsiderTake = await outsiderClient.TakeAsync("WEB-R-1", "WEB-TC-1");
        await api.ArchiveProjectAsync(project.Id);
        var whileArchived = await ownerClient.TakeAsync("WEB-R-1", "WEB-TC-1");

        // Assert
        Assert.Equal(new RegressionPermissionsDto(false, false, false, false), viewerView.Permissions);
        await viewerTake.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await viewerStart.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await outsiderGet.ShouldBeProblemAsync(HttpStatusCode.NotFound, RegressionErrors.NotFound);
        await outsiderById.ShouldBeProblemAsync(HttpStatusCode.NotFound, RegressionErrors.NotFound);
        await outsiderList.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        await outsiderTake.ShouldBeProblemAsync(HttpStatusCode.NotFound, RegressionErrors.NotFound);
        await whileArchived.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
    }
}
