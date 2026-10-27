using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.TestCases;
using Ticketing.Domain.TestCases;

namespace Ticketing.Api.Mcp;

/// <summary>Test case tools (spec 9.3). They call the same handlers as the REST endpoints.</summary>
[McpServerToolType]
public sealed class TestCaseTools
{
    private const string StatusValues = "New (not ready, excluded from regressions), Manual (needs at least one step) or Automatic (auto-passed in regressions)";

    [McpServerTool(Name = "list_test_cases", ReadOnly = true, Idempotent = true, Title = "List test cases")]
    [Description("Lists a project's test cases by number: key (e.g. WEB-TC-7), title, status, linked ticket, step count, archived and last run result, "
        + "plus counts by status. Returns { items, nextCursor, counts }.")]
    public static Task<TestCaseListDto> ListTestCases(
        ListTestCases.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        [Description($"Only these statuses: {StatusValues}.")] TestCaseStatus[]? statuses = null,
        [Description("Only test cases linked to this ticket key, for example WEB-42.")] string? ticketKey = null,
        [Description("Case-insensitive match on title, or a test case key or number.")] string? text = null,
        [Description("Include archived test cases. Default false.")] bool includeArchived = false,
        [Description("Page size 1..100, default 25.")] int? limit = null,
        [Description("nextCursor from the previous page.")] string? cursor = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new ListTestCases.Query(projectKey, statuses, ticketKey, text, includeArchived, new PageRequest(limit, cursor)), cancellationToken);

    [McpServerTool(Name = "get_test_case", ReadOnly = true, Idempotent = true, Title = "Get test case")]
    [Description("Gets a test case by key (for example WEB-TC-7) or id: preconditions, ordered steps, expected result, status, automation reference, "
        + "linked ticket, rowVersion and its latest regression runs.")]
    public static Task<TestCaseDto> GetTestCase(
        GetTestCase.Handler handler,
        [Description("Test case key, for example WEB-TC-7, or id.")] string key,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetTestCase.Query(key), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "create_test_case", Destructive = false, Title = "Create test case")]
    [Description($"Creates a test case in a project. Status is {StatusValues}; default New.")]
    public static Task<TestCaseDto> CreateTestCase(
        CreateTestCase.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        [Description("Single-line title, at most 200 characters.")] string title,
        [Description("Markdown preconditions, at most 4000 characters.")] string? preconditions = null,
        [Description("Ordered steps, 0..50 entries of 1..1000 characters each.")] string[]? steps = null,
        [Description("Markdown expected result, at most 4000 characters.")] string? expectedResult = null,
        [Description($"{StatusValues}. Default New.")] TestCaseStatus? status = null,
        [Description("Name or path of the automated test, at most 500 characters. Meaningful for Automatic.")] string? automationReference = null,
        [Description("Key of the ticket (same project) this case was written for, for example WEB-42.")] string? ticketKey = null,
        [Description("Optional key that makes retries safe: a repeat within 24 hours returns the original result.")] string? idempotencyKey = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(
            new CreateTestCase.Command(title, preconditions, steps, expectedResult, status, automationReference, ticketKey, projectKey, idempotencyKey),
            cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "update_test_case", Destructive = false, Title = "Update test case")]
    [Description("Updates a test case. Only the arguments you pass change; pass null to clear preconditions, expectedResult, automationReference or ticketKey. "
        + $"steps replace the whole list. archived true archives (hidden, excluded from new sessions), false unarchives. Status is {StatusValues}. "
        + "Running and completed regression sessions keep their snapshot.")]
    public static Task<TestCaseDto> UpdateTestCase(
        UpdateTestCase.Handler handler,
        [Description("Test case key, for example WEB-TC-7, or id.")] string key,
        [Description("New single-line title.")] Optional<string> title = default,
        [Description("Markdown preconditions; null clears.")] Optional<string?> preconditions = default,
        [Description("The complete new list of steps.")] Optional<string[]> steps = default,
        [Description("Markdown expected result; null clears.")] Optional<string?> expectedResult = default,
        [Description($"{StatusValues}.")] Optional<TestCaseStatus> status = default,
        [Description("Automated test name or path; null clears.")] Optional<string?> automationReference = default,
        [Description("Ticket key in the same project; null removes the link.")] Optional<string?> ticketKey = default,
        [Description("true archives, false unarchives.")] Optional<bool> archived = default,
        [Description("rowVersion from get_test_case; the update fails with concurrency.conflict if the test case changed since.")] uint? expectedVersion = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(
            new UpdateTestCase.Command
            {
                KeyOrId = key,
                Title = title,
                Preconditions = preconditions,
                Steps = steps.HasValue ? new Optional<IReadOnlyList<string>>(steps.Value) : default,
                ExpectedResult = expectedResult,
                Status = status,
                AutomationReference = automationReference,
                TicketKey = ticketKey,
                Archived = archived,
                ExpectedVersion = expectedVersion,
            },
            cancellationToken);
}
