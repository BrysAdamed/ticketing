using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.TestCases;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Testing;

[Collection(nameof(TestingCollection))]
public sealed class TestCaseEndpointTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Create_and_get_a_manual_test_case_linked_to_a_ticket()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        var ticketKey = await client.CreateStoryAsync(project.Key);

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/projects/WEB/test-cases", new
        {
            title = "  Log in with valid credentials ",
            preconditions = "A registered user",
            steps = new[] { " Open the login page ", "Submit valid credentials" },
            expectedResult = "The dashboard opens",
            status = "Manual",
            ticketKey = "web-1",
        }, _ct);
        var fetched = await (await client.GetAsync("/api/v1/test-cases/web-tc-1", _ct)).ReadAsync<TestCaseDto>();

        // Assert
        var created = await response.ReadAsync<TestCaseDto>(HttpStatusCode.Created);
        Assert.Equal("/api/v1/test-cases/WEB-TC-1", response.Headers.Location?.OriginalString);
        Assert.Equal(("WEB-TC-1", "Log in with valid credentials", TestCaseStatus.Manual), (created.Key, created.Title, created.Status));
        Assert.Equal(["Open the login page", "Submit valid credentials"], created.Steps);
        Assert.Equal(ticketKey, created.Ticket?.Key);
        Assert.Equal("/projects/WEB/test-cases/WEB-TC-1", created.Url);
        Assert.Equal((true, true), (created.Permissions.CanEdit, created.Permissions.CanDelete));
        Assert.Equal(created.Id, fetched.Id);
        Assert.Equal(owner.Id, fetched.CreatedBy.Id);
        var activity = await api.WithDbAsync(db => db.ActivityEntries.SingleAsync(a => a.EntityType == ActivityEntityType.TestCase, _ct));
        Assert.Equal(("testCase.created", WriteChannel.Web), (activity.Action, activity.Channel));
    }

    [Fact]
    public async Task Create_reports_invalid_input()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var otherProject = await client.CreateProjectAsync("APP");
        await client.CreateStoryAsync(otherProject.Key);

        // Act
        var invalid = await client.PostAsJsonAsync("/api/v1/projects/WEB/test-cases",
            new { title = "", steps = Enumerable.Repeat("Step", TestCase.MaxSteps + 1).Append(" ").ToArray() }, _ct);
        var manualWithoutSteps = await client.PostAsJsonAsync("/api/v1/projects/WEB/test-cases", new { title = "Manual", status = "Manual" }, _ct);
        var foreignTicket = await client.PostAsJsonAsync("/api/v1/projects/WEB/test-cases", new { title = "Linked", ticketKey = "APP-1" }, _ct);

        // Assert
        var problem = await invalid.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        var errors = problem.GetProperty("errors");
        Assert.True(errors.TryGetProperty("title", out _));
        Assert.True(errors.TryGetProperty("steps", out _));
        Assert.True(errors.TryGetProperty($"steps[{TestCase.MaxSteps + 1}]", out _));
        await manualWithoutSteps.ShouldBeProblemAsync(HttpStatusCode.BadRequest, TestCaseErrors.ManualRequiresSteps);
        await foreignTicket.ShouldBeProblemAsync(HttpStatusCode.BadRequest, TestCaseErrors.TicketInvalid);
        Assert.Equal(0, await api.WithDbAsync(db => db.TestCases.CountAsync(_ct)));
    }

    [Fact]
    public async Task Update_patches_fields_replaces_steps_and_records_history()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        var project = await client.CreateProjectAsync("WEB");
        await client.CreateStoryAsync(project.Key);
        var created = await client.CreateTestCaseAsync("WEB", "Export", new { preconditions = "Data exists", ticketKey = "WEB-1" });

        // Act
        var response = await client.PatchAsJsonAsync($"/api/v1/test-cases/{created.Key}", new
        {
            steps = new[] { "Open reports", "Click export" },
            status = "Manual",
            preconditions = (string?)null,
            ticketKey = (string?)null,
        }, _ct);

        // Assert
        var updated = await response.ReadAsync<TestCaseDto>();
        Assert.Equal(("Export", TestCaseStatus.Manual, 2), (updated.Title, updated.Status, updated.Steps.Count));
        Assert.Null(updated.Preconditions);
        Assert.Null(updated.Ticket);
        Assert.Equal($"\"{updated.RowVersion}\"", response.Headers.ETag?.Tag);
        var fields = await api.WithDbAsync(db => db.ActivityEntries
            .Where(a => a.Action == "testCase.field.changed").OrderBy(a => a.Field).Select(a => a.Field).ToListAsync(_ct));
        Assert.Equal(["preconditions", "status", "steps", "ticketId"], fields);
    }

    [Fact]
    public async Task Update_with_a_stale_if_match_is_a_conflict_and_manual_cannot_lose_its_steps()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var created = await client.CreateManualCaseAsync("WEB", "Login");
        await (await client.PatchAsJsonAsync($"/api/v1/test-cases/{created.Key}", new { title = "Login v2" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var stale = new HttpRequestMessage(HttpMethod.Patch, $"/api/v1/test-cases/{created.Key}") { Content = JsonContent.Create(new { title = "Mine" }) };
        stale.Headers.IfMatch.Add(new EntityTagHeaderValue($"\"{created.RowVersion}\""));
        var staleResponse = await client.SendAsync(stale, _ct);
        var noSteps = await client.PatchAsJsonAsync($"/api/v1/test-cases/{created.Key}", new { steps = Array.Empty<string>() }, _ct);

        // Assert
        await staleResponse.ShouldBeProblemAsync(HttpStatusCode.Conflict, "concurrency.conflict");
        await noSteps.ShouldBeProblemAsync(HttpStatusCode.BadRequest, TestCaseErrors.ManualRequiresSteps);
    }

    [Fact]
    public async Task List_filters_by_status_ticket_text_and_archive_and_counts_by_status()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        var project = await client.CreateProjectAsync("WEB");
        await client.CreateStoryAsync(project.Key);
        await client.CreateManualCaseAsync("WEB", "Login works");
        await client.CreateAutomaticCaseAsync("WEB", "Logout works");
        await client.CreateTestCaseAsync("WEB", "Export draft", new { ticketKey = "WEB-1" });
        var archived = await client.CreateManualCaseAsync("WEB", "Legacy login");
        await (await client.PatchAsJsonAsync($"/api/v1/test-cases/{archived.Key}", new { archived = true }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var all = await ListAsync(client, "");
        var manualAndAutomatic = await ListAsync(client, "?status=Manual&status=Automatic");
        var byText = await ListAsync(client, "?text=LOG&includeArchived=true");
        var byKey = await ListAsync(client, "?text=web-tc-2");
        var byTicket = await ListAsync(client, "?ticket=WEB-1");
        var firstPage = await ListAsync(client, "?limit=2");
        var secondPage = await ListAsync(client, $"?limit=2&cursor={firstPage.NextCursor}");

        // Assert
        Assert.Equal(["WEB-TC-1", "WEB-TC-2", "WEB-TC-3"], all.Items.Select(i => i.Key));
        Assert.Equal((1, 1, 1, 1), (all.Counts.New, all.Counts.Manual, all.Counts.Automatic, all.Counts.Archived));
        Assert.Equal(["WEB-TC-1", "WEB-TC-2"], manualAndAutomatic.Items.Select(i => i.Key));
        Assert.Equal(["WEB-TC-1", "WEB-TC-2", "WEB-TC-4"], byText.Items.Select(i => i.Key));
        Assert.True(byText.Items[2].Archived);
        Assert.Equal((1, 1, 0, 1), (byText.Counts.Manual, byText.Counts.Automatic, byText.Counts.New, byText.Counts.Archived));
        Assert.Equal("WEB-TC-2", Assert.Single(byKey.Items).Key);
        Assert.Equal("WEB-1", Assert.Single(byTicket.Items).Ticket?.Key);
        Assert.Equal(2, all.Items[0].StepCount);
        Assert.Equal(["WEB-TC-1", "WEB-TC-2"], firstPage.Items.Select(i => i.Key));
        Assert.Equal(["WEB-TC-3"], secondPage.Items.Select(i => i.Key));
        Assert.Null(secondPage.NextCursor);
    }

    [Fact]
    public async Task Ticket_test_cases_list_only_non_archived_cases_of_that_ticket()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        var project = await client.CreateProjectAsync("WEB");
        await client.CreateStoryAsync(project.Key);
        await client.CreateStoryAsync(project.Key);
        await client.CreateTestCaseAsync("WEB", "First", new { ticketKey = "WEB-1" });
        await client.CreateTestCaseAsync("WEB", "Other ticket", new { ticketKey = "WEB-2" });
        var archived = await client.CreateTestCaseAsync("WEB", "Archived", new { ticketKey = "WEB-1" });
        await client.PatchAsJsonAsync($"/api/v1/test-cases/{archived.Key}", new { archived = true }, _ct);

        // Act
        var cases = await (await client.GetAsync("/api/v1/tickets/web-1/test-cases", _ct)).ReadAsync<List<TestCaseSummaryDto>>();
        var missing = await client.GetAsync("/api/v1/tickets/WEB-99/test-cases", _ct);

        // Assert
        Assert.Equal("First", Assert.Single(cases).Title);
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, "ticket.notFound");
    }

    [Fact]
    public async Task Delete_is_owner_only_and_only_for_cases_never_used_in_a_session()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var memberClient = await api.LoginAsync(member);
        var project = await ownerClient.CreateProjectAsync("WEB");
        await api.AddMemberAsync(project.Id, member, ProjectRole.Member);
        var unused = await ownerClient.CreateTestCaseAsync("WEB", "Unused");
        var used = await ownerClient.CreateManualCaseAsync("WEB", "Used");
        await ownerClient.StartSessionAsync("WEB");

        // Act
        var byMember = await memberClient.DeleteAsync($"/api/v1/test-cases/{unused.Key}", _ct);
        var usedDelete = await ownerClient.DeleteAsync($"/api/v1/test-cases/{used.Key}", _ct);
        var unusedDelete = await ownerClient.DeleteAsync($"/api/v1/test-cases/{unused.Key}", _ct);
        var usedView = await (await ownerClient.GetAsync($"/api/v1/test-cases/{used.Key}", _ct)).ReadAsync<TestCaseDto>();

        // Assert
        await byMember.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await usedDelete.ShouldBeProblemAsync(HttpStatusCode.Conflict, TestCaseErrors.UsedInSession);
        await unusedDelete.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        Assert.Equal(1, await api.WithDbAsync(db => db.TestCases.CountAsync(_ct)));
        Assert.Equal((1, false), (usedView.SessionCount, usedView.Permissions.CanDelete));
        Assert.Equal("WEB-R-1", Assert.Single(usedView.RecentRuns).SessionKey);
    }

    [Fact]
    public async Task Permissions_follow_effective_project_access()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var viewerClient = await api.LoginAsync(viewer);
        var outsiderClient = await api.LoginAsync(outsider);
        var priv = await ownerClient.CreateProjectAsync("PRIV");
        await ownerClient.CreateProjectAsync("PUB", ProjectVisibility.Public);
        await api.AddMemberAsync(priv.Id, viewer, ProjectRole.Viewer);
        var privateTicket = await ownerClient.CreateStoryAsync(priv.Key);
        var privateCase = await ownerClient.CreateTestCaseAsync("PRIV", "Secret", new { status = "Manual", steps = new[] { "Step" }, ticketKey = privateTicket });

        // Act
        var outsiderTicketCases = await outsiderClient.GetAsync($"/api/v1/tickets/{privateTicket}/test-cases", _ct);
        var viewerTicketCases = await (await viewerClient.GetAsync($"/api/v1/tickets/{privateTicket}/test-cases", _ct)).ReadAsync<List<TestCaseSummaryDto>>();
        var viewerRead = await (await viewerClient.GetAsync($"/api/v1/test-cases/{privateCase.Key}", _ct)).ReadAsync<TestCaseDto>();
        var viewerCreate = await viewerClient.PostAsJsonAsync("/api/v1/projects/PRIV/test-cases", new { title = "No" }, _ct);
        var viewerUpdate = await viewerClient.PatchAsJsonAsync($"/api/v1/test-cases/{privateCase.Key}", new { title = "No" }, _ct);
        var outsiderGet = await outsiderClient.GetAsync($"/api/v1/test-cases/{privateCase.Key}", _ct);
        var outsiderById = await outsiderClient.GetAsync($"/api/v1/test-cases/{privateCase.Id}", _ct);
        var outsiderList = await outsiderClient.GetAsync("/api/v1/projects/PRIV/test-cases", _ct);
        var outsiderPatch = await outsiderClient.PatchAsJsonAsync($"/api/v1/test-cases/{privateCase.Key}", new { title = "No" }, _ct);
        var publicCreate = await outsiderClient.PostAsJsonAsync("/api/v1/projects/PUB/test-cases", new { title = "Anyone can write" }, _ct);
        var readOnlyToken = await (await api.CreatePatClientAsync(owner, PatScope.ReadOnly))
            .PostAsJsonAsync("/api/v1/projects/PRIV/test-cases", new { title = "No" }, _ct);

        // Assert
        Assert.Equal((false, false), (viewerRead.Permissions.CanEdit, viewerRead.Permissions.CanDelete));
        await viewerCreate.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await viewerUpdate.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await outsiderGet.ShouldBeProblemAsync(HttpStatusCode.NotFound, TestCaseErrors.NotFound);
        await outsiderById.ShouldBeProblemAsync(HttpStatusCode.NotFound, TestCaseErrors.NotFound);
        await outsiderList.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        await outsiderPatch.ShouldBeProblemAsync(HttpStatusCode.NotFound, TestCaseErrors.NotFound);
        await publicCreate.ShouldHaveStatusAsync(HttpStatusCode.Created);
        await outsiderTicketCases.ShouldBeProblemAsync(HttpStatusCode.NotFound, "ticket.notFound");
        Assert.Equal(privateCase.Key, Assert.Single(viewerTicketCases).Key);
        await readOnlyToken.ShouldHaveStatusAsync(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Archived_project_is_read_only_and_create_is_idempotent()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        var project = await client.CreateProjectAsync("WEB");
        var request = () => new HttpRequestMessage(HttpMethod.Post, "/api/v1/projects/WEB/test-cases")
        {
            Content = JsonContent.Create(new { title = "Once" }),
            Headers = { { "Idempotency-Key", "abc" } },
        };

        // Act
        var first = await (await client.SendAsync(request(), _ct)).ReadAsync<TestCaseDto>(HttpStatusCode.Created);
        var repeat = await (await client.SendAsync(request(), _ct)).ReadAsync<TestCaseDto>(HttpStatusCode.Created);
        await api.ArchiveProjectAsync(project.Id);
        var whileArchived = await client.PostAsJsonAsync("/api/v1/projects/WEB/test-cases", new { title = "Later" }, _ct);

        // Assert
        Assert.Equal(first.Id, repeat.Id);
        await whileArchived.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
        Assert.Equal(1, await api.WithDbAsync(db => db.TestCases.CountAsync(_ct)));
    }

    private async Task<TestCaseListDto> ListAsync(HttpClient client, string query) =>
        await (await client.GetAsync($"/api/v1/projects/WEB/test-cases{query}", _ct)).ReadAsync<TestCaseListDto>();
}
