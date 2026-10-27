using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.Regressions;
using Ticketing.Domain.Regressions;

namespace Ticketing.Api.Mcp;

/// <summary>Regression session tools (spec 9.3). Sessions are referenced by key (WEB-R-3), items by test case key (WEB-TC-7).</summary>
[McpServerToolType]
public sealed class RegressionTools
{
    private const string SessionStatuses = "InProgress, Completed or Cancelled";
    private const string ItemStatuses = "WaitingForExecution, Passed, Failed or Skipped";
    private const string SessionKey = "Session key, for example WEB-R-3, or id.";
    private const string BugSeverities = "Severity: Blocker, Critical, Major, Minor or Trivial.";
    private const string BugPriorities = "Priority: Highest, High, Medium, Low or Lowest.";
    private const string TestCaseKey ="Test case key of the item, for example WEB-TC-7 (item id or test case id also work).";

    [McpServerTool(Name = "list_regression_sessions", ReadOnly = true, Idempotent = true, Title = "List regression sessions")]
    [Description("Lists a project's regression sessions, newest first, with summary counts (total, passed manual/automatic, failed, skipped, waiting, "
        + "pass rate = passed / (passed + failed), bugs created). Returns { items, nextCursor }.")]
    public static Task<CursorPage<RegressionSessionSummaryDto>> ListRegressionSessions(
        ListRegressionSessions.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        [Description($"Only sessions with this status: {SessionStatuses}.")] RegressionSessionStatus? status = null,
        [Description("Page size 1..100, default 25.")] int? limit = null,
        [Description("nextCursor from the previous page.")] string? cursor = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(
            new ListRegressionSessions.Query(projectKey, status is { } s ? [s] : null, new PageRequest(limit, cursor)), cancellationToken);

    [McpServerTool(Name = "get_regression_session", ReadOnly = true, Idempotent = true, Title = "Get regression session")]
    [Description("Gets a regression session with its summary and items in order: snapshot fields (title, preconditions, steps, expected result), "
        + $"execution mode (Manual or Automatic), status ({ItemStatuses}), autoPassed, assignee, result note and bug key.")]
    public static Task<RegressionSessionDto> GetRegressionSession(
        GetRegressionSession.Handler handler,
        [Description(SessionKey)] string sessionKey,
        [Description($"Only items with this status: {ItemStatuses}.")] RegressionItemStatus? itemStatus = null,
        [Description("Only items assigned to this user: email, id, 'me' or 'unassigned'.")] string? assignee = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetRegressionSession.Query(sessionKey, itemStatus is { } s ? [s] : null, assignee), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "start_regression_session", Destructive = false, Title = "Start regression session")]
    [Description("Starts a regression session over every non-archived Manual or Automatic test case of the project (New cases are excluded). "
        + "Manual items start WaitingForExecution, Automatic items are auto-passed. Fails with regression.noEligibleCases when there are none.")]
    public static Task<RegressionSessionDto> StartRegressionSession(
        StartRegressionSession.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        [Description("Session name, at most 100 characters. Default 'Regression yyyy-MM-dd'.")] string? name = null,
        [Description("Version under test, at most 50 characters (see get_field_hints). Copied into bugs created from the session.")] string? version = null,
        [Description("Optional key that makes retries safe: a repeat within 24 hours returns the original result.")] string? idempotencyKey = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new StartRegressionSession.Command(name, version, projectKey, idempotencyKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "take_regression_item", Destructive = false, Idempotent = true, Title = "Take regression item")]
    [Description("Assigns a session item to you, also taking it over from another assignee. Only the assignee can record results.")]
    public static Task<RegressionItemChangeDto> TakeRegressionItem(
        TakeRegressionItem.Handler handler,
        [Description(SessionKey)] string sessionKey,
        [Description(TestCaseKey)] string testCaseKey,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new TakeRegressionItem.Command(sessionKey, testCaseKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "assign_regression_item", Destructive = false, Idempotent = true, Title = "Assign regression item")]
    [Description("Assigns a session item to a user who can write to the project, or unassigns it with null. Project Owners only.")]
    public static Task<RegressionItemChangeDto> AssignRegressionItem(
        AssignRegressionItem.Handler handler,
        [Description(SessionKey)] string sessionKey,
        [Description(TestCaseKey)] string testCaseKey,
        [Description("Assignee email, id or 'me'; null unassigns.")] string? assignee,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new AssignRegressionItem.Command(assignee, sessionKey, testCaseKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "record_regression_result", Destructive = false, Title = "Record regression result")]
    [Description($"Records an item result: {ItemStatuses} (WaitingForExecution resets it). Failed requires a note with the actual result. "
        + "Only the assignee records; an unassigned item is assigned to you first. With createBug (Failed only, once per item) it also creates a Bug "
        + "at the top of the backlog: title '[Regression] <test case title>', templated repro steps, Severity Major, Priority High, the session version, "
        + "label regression, linked RelatesTo the test case's ticket; bugTitle, bugSeverity, bugPriority and bugAssignee override the defaults. "
        + "Returns the item, the refreshed session summary and the created bug.")]
    public static Task<RegressionItemChangeDto> RecordRegressionResult(
        RecordRegressionResult.Handler handler,
        [Description(SessionKey)] string sessionKey,
        [Description(TestCaseKey)] string testCaseKey,
        [Description($"Result: {ItemStatuses}.")] RegressionItemStatus status,
        [Description("Markdown note, at most 4000 characters; required for Failed (the actual result).")] string? note = null,
        [Description("Also create the bug for this failure. Default false.")] bool createBug = false,
        [Description("Bug title instead of '[Regression] <test case title>'.")] string? bugTitle = null,
        [Description(BugSeverities + " Default Major.")] Domain.Tickets.Severity? bugSeverity = null,
        [Description(BugPriorities + " Default High.")] Domain.Tickets.Priority? bugPriority = null,
        [Description("Bug assignee email, id or 'me'. Default unassigned.")] string? bugAssignee = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(
            new RecordRegressionResult.Command(
                status, note, createBug,
                new BugOverrides
                {
                    Title = bugTitle,
                    Severity = bugSeverity is { } severity ? new Optional<Domain.Tickets.Severity?>(severity) : default,
                    Priority = bugPriority,
                    Assignee = bugAssignee,
                },
                sessionKey, testCaseKey),
            cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "complete_regression_session", Destructive = false, Title = "Complete regression session")]
    [Description("Completes a session. Fails with regression.hasWaitingItems while items are WaitingForExecution, unless skipRemaining is true "
        + "(they become Skipped with note 'Skipped at completion'). Completed sessions are immutable.")]
    public static Task<RegressionSessionSummaryDto> CompleteRegressionSession(
        CompleteRegressionSession.Handler handler,
        [Description(SessionKey)] string sessionKey,
        [Description("Skip all waiting items. Default false.")] bool skipRemaining = false,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new CompleteRegressionSession.Command(skipRemaining, sessionKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpMeta(McpToolMeta.RequiresUserInteraction, true)]
    [McpServerTool(Name = "cancel_regression_session", Destructive = true, Title = "Cancel regression session")]
    [Description("Cancels an in-progress session (project Owners or the person who started it). Cancelled sessions are read-only.")]
    public static Task<RegressionSessionSummaryDto> CancelRegressionSession(
        CancelRegressionSession.Handler handler,
        [Description(SessionKey)] string sessionKey,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new CancelRegressionSession.Command(sessionKey), cancellationToken);
}
