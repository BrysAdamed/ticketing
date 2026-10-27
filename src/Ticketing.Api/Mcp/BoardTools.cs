using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Application.Boards;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Tickets;

namespace Ticketing.Api.Mcp;

/// <summary>Board tools and move_ticket (spec 9.3). Board deletion stays in the web UI.</summary>
[McpServerToolType]
public sealed class BoardTools
{
    private const string Statuses = "ToDo, InProgress, OnHold, Review, ReadyForTesting, Testing, ReadyForDeploy or Done";

    [McpServerTool(Name = "list_boards", ReadOnly = true, Idempotent = true, Title = "List boards")]
    [Description("Lists boards ordered by name: id, name, owner, linked project keys you can read and the cards you can see by status category "
        + "(ToDo, InProgress, Done). Returns { items, nextCursor }.")]
    public static Task<CursorPage<BoardSummaryDto>> ListBoards(
        ListBoards.Handler handler,
        [Description("Filter by board name (case-insensitive substring).")] string? query = null,
        [Description("Only boards linking this project key, for example WEB.")] string? projectKey = null,
        [Description("Include archived boards. Default false.")] bool includeArchived = false,
        [Description("Page size 1..100, default 25.")] int? limit = null,
        [Description("nextCursor from the previous page.")] string? cursor = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new ListBoards.Query(query, projectKey, includeArchived, Page: new PageRequest(limit, cursor)), cancellationToken);

    [McpServerTool(Name = "get_board", ReadOnly = true, Idempotent = true, Title = "Get board")]
    [Description("Gets a board: fields, linked projects you can read, and one column per status (" + Statuses + ") with the tickets you can read in board order.")]
    public static async Task<BoardToolDto> GetBoard(
        GetBoard.Handler handler,
        [Description("Board id.")] string boardId,
        [Description("Only these columns: " + Statuses + ". Default all.")] TicketStatus[]? statuses = null,
        [Description("Only tickets assigned to this user: email, id, 'me' or 'unassigned'.")] string? assignee = null,
        CancellationToken cancellationToken = default) =>
        BoardToolDto.From(await handler.HandleAsync(new GetBoard.Query(boardId, statuses, assignee), cancellationToken));

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "create_board", Destructive = false, Title = "Create board")]
    [Description("Creates a board linking 1..20 projects you can write to; you become its owner. Returns the board.")]
    public static async Task<BoardToolDto> CreateBoard(
        CreateBoard.Handler handler,
        [Description("Board name, at most 100 characters.")] string name,
        [Description("Project keys to link, for example [\"WEB\", \"API\"].")] string[] projectKeys,
        [Description("Markdown description, at most 2000 characters.")] string? description = null,
        [Description("Optional key that makes retries safe: a repeat within 24 hours returns the original result.")] string? idempotencyKey = null,
        CancellationToken cancellationToken = default) =>
        BoardToolDto.From(await handler.HandleAsync(new CreateBoard.Command(name, description, projectKeys, idempotencyKey), cancellationToken));

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "update_board", Destructive = false, Title = "Update board")]
    [Description("Updates a board (owner or Admin). Omitted fields stay unchanged. Unlinking a project sends its tickets on the board to the top "
        + "of its backlog. Returns the board.")]
    public static async Task<BoardToolDto> UpdateBoard(
        UpdateBoard.Handler handler,
        [Description("Board id.")] string boardId,
        [Description("New name.")] string? name = null,
        [Description("Markdown description; null clears.")] Optional<string?> description = default,
        [Description("Project keys to link (you need write access to them).")] string[]? addProjectKeys = null,
        [Description("Project keys to unlink.")] string[]? removeProjectKeys = null,
        [Description("Email of the new owner (an active user).")] string? ownerEmail = null,
        [Description("The rowVersion you read; fails with concurrency.conflict if the board changed since.")] uint? expectedVersion = null,
        CancellationToken cancellationToken = default) =>
        BoardToolDto.From(await handler.HandleAsync(
            new UpdateBoard.Command
            {
                BoardId = boardId,
                Name = name is null ? default(Optional<string>) : name,
                Description = description,
                AddProjectKeys = addProjectKeys,
                RemoveProjectKeys = removeProjectKeys,
                Owner = ownerEmail is null ? default(Optional<string>) : ownerEmail,
                ExpectedVersion = expectedVersion,
            },
            cancellationToken));

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "archive_board", Destructive = true, Title = "Archive board")]
    [Description("Archives a board (owner or Admin); it becomes read-only. Done tickets stay on it. The others go to carryOverTo: 'backlog' "
        + "(top of each ticket's project backlog) or another active board's id (bottom; tickets whose project it does not link go to the backlog). "
        + "Returns the board and how many tickets went where.")]
    public static async Task<ArchiveBoardToolResultDto> ArchiveBoard(
        ArchiveBoard.Handler handler,
        [Description("Board id.")] string boardId,
        [Description("'backlog' or the id of another active board.")] string carryOverTo,
        CancellationToken cancellationToken = default)
    {
        var result = await handler.HandleAsync(new ArchiveBoard.Command(carryOverTo, boardId), cancellationToken);
        return new ArchiveBoardToolResultDto(
            BoardToolDto.From(result.Board), result.CarriedOverToBoardId, result.MovedToBoard, result.MovedToBacklog, result.StayedDone);
    }

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "move_ticket", Destructive = false, Title = "Move tickets")]
    [Description("Moves 1..50 tickets as one block, in the order given: to 'backlog' (each to its own project backlog, top by default) or to a board id "
        + "(bottom of the status column by default). Optional status sets the column (" + Statuses + "), with the usual status rules (entering Done "
        + "sets resolution Done). beforeKey or afterKey places the block next to another ticket in the target; use it with target 'backlog' to "
        + "reorder a backlog. Returns the moved ticket summaries.")]
    public static Task<IReadOnlyList<TicketSummaryDto>> MoveTicket(
        MoveTickets.Handler handler,
        [Description("Ticket keys (for example [\"WEB-42\"]) or ids, 1..50.")] string[] keys,
        [Description("'backlog' or a board id.")] string target,
        [Description("Target column: " + Statuses + ". Omit to keep each ticket's status.")] TicketStatus? status = null,
        [Description("Place the tickets right before this ticket.")] string? beforeKey = null,
        [Description("Place the tickets right after this ticket.")] string? afterKey = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new MoveTickets.Command(keys, target, status, beforeKey, afterKey), cancellationToken);
}
