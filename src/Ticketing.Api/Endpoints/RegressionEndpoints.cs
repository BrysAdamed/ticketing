using Ticketing.Api.Http;
using Ticketing.Application.Common;
using Ticketing.Application.Regressions;
using Ticketing.Domain.Regressions;

namespace Ticketing.Api.Endpoints;

/// <summary>
/// Regression sessions (spec 4.10, 4.11, 6.11). Sessions are addressed by key (<c>WEB-R-3</c>) or id; items inside a
/// session by test case key (<c>WEB-TC-7</c>), item id or test case id.
/// </summary>
public sealed class RegressionEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var project = api.MapGroup("/projects/{projectKeyOrId}/regression-sessions").WithTags("Regressions");

        project.MapGet("", async (
                string projectKeyOrId, RegressionSessionStatus[]? status, int? limit, string? cursor, ListRegressionSessions.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new ListRegressionSessions.Query(projectKeyOrId, status, new PageRequest(limit, cursor)), ct)))
            .WithSummary("Sessions, newest first, with summary counts and pass rate. Repeat status for several values.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        project.MapPost("", async (
                string projectKeyOrId, StartRegressionSession.Command command, StartRegressionSession.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var session = await handler.HandleAsync(command with { ProjectKeyOrId = projectKeyOrId, IdempotencyKey = request.IdempotencyKeyHeader() }, ct);
                return TypedResults.Created($"/api/v1/regression-sessions/{session.Key}", session);
            })
            .WithSummary("Starts a session over every non-archived Manual or Automatic test case (Automatic ones are auto-passed). Accepts an Idempotency-Key header.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        var session = api.MapGroup("/regression-sessions/{sessionKeyOrId}").WithTags("Regressions");

        session.MapGet("", async (
                string sessionKeyOrId, RegressionItemStatus[]? itemStatus, string? assignee, GetRegressionSession.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new GetRegressionSession.Query(sessionKeyOrId, itemStatus, assignee), ct)))
            .WithSummary("A session with its summary and items. itemStatus (repeatable) and assignee (me, unassigned, email or id) filter the items.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        session.MapPost("/complete", async (
                string sessionKeyOrId, CompleteRegressionSession.Command? command, CompleteRegressionSession.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync((command ?? new CompleteRegressionSession.Command()) with { SessionKeyOrId = sessionKeyOrId }, ct)))
            .WithSummary("Completes the session; fails with regression.hasWaitingItems unless skipRemaining is true.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);

        session.MapPost("/cancel", async (string sessionKeyOrId, CancelRegressionSession.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new CancelRegressionSession.Command(sessionKeyOrId), ct)))
            .WithSummary("Cancels the session (Owner or the session starter).")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);

        var item = session.MapGroup("/items/{item}");

        item.MapPost("/take", async (string sessionKeyOrId, string item, TakeRegressionItem.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new TakeRegressionItem.Command(sessionKeyOrId, item), ct)))
            .WithSummary("Assigns the item to you, taking it over from another assignee.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        item.MapPost("/assign", async (
                string sessionKeyOrId, string item, AssignRegressionItem.Command command, AssignRegressionItem.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(command with { SessionKeyOrId = sessionKeyOrId, Item = item }, ct)))
            .WithSummary("Assigns the item to a user with write access (email or id), or unassigns it with null. Owner only.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);

        item.MapPost("/result", async (
                string sessionKeyOrId, string item, RecordRegressionResult.Command command, RecordRegressionResult.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(command with { SessionKeyOrId = sessionKeyOrId, Item = item }, ct)))
            .WithSummary("Records Passed, Failed (note required), Skipped or WaitingForExecution. Only the assignee; an unassigned item is assigned to you.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);

        item.MapGet("/bug-draft", async (string sessionKeyOrId, string item, GetRegressionBugDraft.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new GetRegressionBugDraft.Query(sessionKeyOrId, item), ct)))
            .WithSummary("The pre-filled bug for a failed item (title, templated description, severity, priority, version, labels, related ticket).")
            .ProducesProblem(StatusCodes.Status409Conflict);

        item.MapPost("/bug", async (
                string sessionKeyOrId, string item, BugOverrides? overrides, CreateRegressionBug.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var change = await handler.HandleAsync(new CreateRegressionBug.Command(overrides, sessionKeyOrId, item), ct);
                return TypedResults.Created(change.CreatedBug is { } bug ? $"/api/v1/tickets/{bug.Key}" : null, change);
            })
            .WithSummary("Creates the bug for a failed item (once): the draft from bug-draft plus any field you send, at the top of the backlog, "
                + "linked RelatesTo the test case's ticket. Returns the item, the session summary and the created bug.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }
}
