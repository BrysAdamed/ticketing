using Ticketing.Api.Http;
using Ticketing.Application.Boards;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Tickets;

namespace Ticketing.Api.Endpoints;

/// <summary>Boards (spec 4.12, 5.4, 6.4) and ticket moves between backlogs and boards. Boards are addressed by id.</summary>
public sealed class BoardEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var boards = api.MapGroup("/boards").WithTags("Boards");

        boards.MapGet("", async (
                ListBoards.Handler handler, string? query, string? projectKey, bool? includeArchived, bool? mine, int? limit, string? cursor,
                CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(
                new ListBoards.Query(query, projectKey, includeArchived ?? false, mine ?? false, new PageRequest(limit, cursor)), ct)))
            .WithSummary("Boards ordered by name, with linked projects and card counts by status category the caller can see.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        boards.MapGet("/{boardId:guid}", async (
                Guid boardId, TicketStatus[]? status, string? assignee, GetBoard.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var board = await handler.HandleAsync(new GetBoard.Query(boardId.ToString(), status, assignee), ct);
                response.SetRowVersion(board.RowVersion);
                return TypedResults.Ok(board);
            })
            .WithSummary("A board with its 8 status columns and the cards the caller can read, in rank order. Repeat status to pick columns; assignee is an id, email, me or unassigned.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        boards.MapPost("", async (CreateBoard.Command command, CreateBoard.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var board = await handler.HandleAsync(command with { IdempotencyKey = request.IdempotencyKeyHeader() }, ct);
                request.HttpContext.Response.SetRowVersion(board.RowVersion);
                return TypedResults.Created($"/api/v1/boards/{board.Id}", board);
            })
            .WithSummary("Creates a board linking 1..20 projects you can write to; you become its owner. Accepts an Idempotency-Key header.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        boards.MapPatch("/{boardId:guid}", async (
                Guid boardId, UpdateBoard.Command command, UpdateBoard.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var board = await handler.HandleAsync(command with { BoardId = boardId.ToString(), ExpectedVersion = request.ExpectedRowVersion() }, ct);
                request.HttpContext.Response.SetRowVersion(board.RowVersion);
                return TypedResults.Ok(board);
            })
            .WithSummary("Renames, describes, links or unlinks projects (their tickets return to the backlog top) or transfers ownership. Owner or Admin.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        boards.MapPost("/{boardId:guid}/archive", async (
                Guid boardId, ArchiveBoard.Command command, ArchiveBoard.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(command with { BoardId = boardId.ToString() }, ct)))
            .WithSummary("Archives the board. Done tickets stay; the others go to carryOverTo: 'backlog' (top) or another board (bottom) when it links their project.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        boards.MapPost("/{boardId:guid}/unarchive", async (Guid boardId, UnarchiveBoard.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new UnarchiveBoard.Command(boardId.ToString()), ct)))
            .WithSummary("Unarchives the board. Owner or Admin.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        boards.MapDelete("/{boardId:guid}", async (Guid boardId, DeleteBoard.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new DeleteBoard.Command(boardId.ToString()), ct);
                return TypedResults.NoContent();
            })
            .WithSummary("Deletes the board; all its tickets, Done included, return to the top of their backlogs. Owner or Admin.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        api.MapPost("/tickets/move", async (MoveTickets.Command command, MoveTickets.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command, ct)))
            .WithTags("Boards")
            .WithSummary("Moves 1..50 tickets as a block to 'backlog' or a board id, optionally into a status column, before or after another ticket. Also reorders.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }
}
