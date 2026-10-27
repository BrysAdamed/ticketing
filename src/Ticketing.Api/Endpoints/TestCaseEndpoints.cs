using Ticketing.Api.Http;
using Ticketing.Application.Common;
using Ticketing.Application.TestCases;
using Ticketing.Domain.TestCases;

namespace Ticketing.Api.Endpoints;

/// <summary>Test cases (spec 4.9, 6.10). Addressed by key (<c>WEB-TC-7</c>) or id.</summary>
public sealed class TestCaseEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var project = api.MapGroup("/projects/{projectKeyOrId}/test-cases").WithTags("Test cases");

        project.MapGet("", async (
                string projectKeyOrId, TestCaseStatus[]? status, string? ticket, string? text, bool? includeArchived, int? limit, string? cursor,
                ListTestCases.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(
                new ListTestCases.Query(projectKeyOrId, status, ticket, text, includeArchived ?? false, new PageRequest(limit, cursor)), ct)))
            .WithSummary("Test cases by number with counts by status. Repeat status for several values; ticket is a key or id; text matches the title or key.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        project.MapPost("", async (
                string projectKeyOrId, CreateTestCase.Command command, CreateTestCase.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var testCase = await handler.HandleAsync(command with { ProjectKeyOrId = projectKeyOrId, IdempotencyKey = request.IdempotencyKeyHeader() }, ct);
                request.HttpContext.Response.SetRowVersion(testCase.RowVersion);
                return TypedResults.Created($"/api/v1/test-cases/{testCase.Key}", testCase);
            })
            .WithSummary("Creates a test case (status New unless given; Manual needs at least one step). Accepts an Idempotency-Key header.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        var testCases = api.MapGroup("/test-cases/{keyOrId}").WithTags("Test cases");

        testCases.MapGet("", async (string keyOrId, GetTestCase.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var testCase = await handler.HandleAsync(new GetTestCase.Query(keyOrId), ct);
                response.SetRowVersion(testCase.RowVersion);
                return TypedResults.Ok(testCase);
            })
            .WithSummary("A test case with its linked ticket and latest regression runs.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        testCases.MapPatch("", async (string keyOrId, UpdateTestCase.Command command, UpdateTestCase.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var testCase = await handler.HandleAsync(command with { KeyOrId = keyOrId, ExpectedVersion = request.ExpectedRowVersion() }, ct);
                request.HttpContext.Response.SetRowVersion(testCase.RowVersion);
                return TypedResults.Ok(testCase);
            })
            .WithSummary("Updates fields (steps replace the list; archived archives or unarchives). Omitted fields stay, null clears. If-Match is optional.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        testCases.MapDelete("", async (string keyOrId, DeleteTestCase.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new DeleteTestCase.Command(keyOrId), ct);
                return TypedResults.NoContent();
            })
            .WithSummary("Hard-deletes a test case that never appeared in a regression session (Owner only); otherwise testCase.usedInSession.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        api.MapGet("/tickets/{ticketKeyOrId}/test-cases", async (string ticketKeyOrId, ListTicketTestCases.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListTicketTestCases.Query(ticketKeyOrId), ct)))
            .WithTags("Test cases")
            .WithSummary("The non-archived test cases written for a ticket, by number.")
            .ProducesProblem(StatusCodes.Status404NotFound);
    }
}
