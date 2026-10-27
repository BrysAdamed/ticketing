using Microsoft.AspNetCore.Mvc;
using Ticketing.Api.Http;
using Ticketing.Application.Backlog;
using Ticketing.Application.Comments;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Tickets;

namespace Ticketing.Api.Endpoints;

/// <summary>Tickets, backlog, links, comments, history and field hints. Tickets are addressed by key (<c>WEB-42</c>) or id.</summary>
public sealed class TicketEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        MapProjectScoped(api.MapGroup("/projects/{projectKeyOrId}").WithTags("Tickets"));
        MapTickets(api.MapGroup("/tickets/{keyOrId}").WithTags("Tickets"));
        MapComments(api.MapGroup("/comments/{commentId:guid}").WithTags("Tickets"));

        api.MapPost("/tickets/move", async (MoveTickets.Command command, MoveTickets.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command, ct)))
            .WithTags("Tickets")
            .WithSummary("The one placement call: moves 1..100 tickets as a block to 'backlog' or a board id, optionally into a status column, "
                + "before/after another ticket or to the Top/Bottom. Reorders a backlog or board too. 'from' guards against stale views. "
                + "includeChildren also moves each ticket's sub-tickets that are still in the place it is leaving and not Done, right after it.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        api.MapGet("/tickets/move/children", async ([FromQuery] string[] keys, string? from, GetMoveChildren.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetMoveChildren.Query(keys, from), ct)))
            .WithTags("Tickets")
            .WithSummary("Previews a move with includeChildren: per ticket, the sub-tickets that would come along (still in the place it is "
                + "leaving, not Done) and how many stay behind because they are on another board, in the backlog or Done.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }

    private static void MapProjectScoped(RouteGroupBuilder project)
    {
        project.MapPost("/tickets", async (
                string projectKeyOrId, CreateTicket.Command command, CreateTicket.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var ticket = await handler.HandleAsync(
                    command with { ProjectKeyOrId = projectKeyOrId, IdempotencyKey = request.IdempotencyKeyHeader(), Placement = BacklogPlacement.Bottom }, ct);
                request.HttpContext.Response.SetRowVersion(ticket.RowVersion);
                return TypedResults.Created($"/api/v1/tickets/{ticket.Key}", ticket);
            })
            .WithSummary("Creates a ticket at the bottom of the backlog (or of a board). Accepts an Idempotency-Key header.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        project.MapGet("/tickets/find", async (
                string projectKeyOrId, string? text, TicketType[]? type, int? limit, FindTickets.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new FindTickets.Query(projectKeyOrId, text, type, limit), ct)))
            .WithSummary("Up to 20 tickets of the project matching a key or title, for pickers.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        project.MapPost("/tickets/batch", async (
                string projectKeyOrId, CreateTickets.Command command, CreateTickets.Handler handler, HttpRequest request, CancellationToken ct) =>
            TypedResults.Created(
                $"/api/v1/projects/{projectKeyOrId}/backlog",
                await handler.HandleAsync(command with { ProjectKeyOrId = projectKeyOrId, IdempotencyKey = request.IdempotencyKeyHeader() }, ct)))
            .WithSummary("Creates 1..50 tickets, all or nothing. parentKey may reference an earlier item as #index.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);

        project.MapGet("/backlog", async (
                string projectKeyOrId, GetBacklog.Handler handler, bool? showDone, TicketType[]? type, TicketStatus[]? status, Priority[]? priority,
                string? assignee, string[]? label, string? version, string? text, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(
                new GetBacklog.Query(projectKeyOrId, showDone ?? false, type, status, priority, assignee, label, version, text), ct)))
            .WithSummary("The project backlog in rank order (no paging). Repeat type/status/priority/label for several values; assignee is an id, email, me or unassigned.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        project.MapGet("/hints/{field}", async (string projectKeyOrId, string field, string? prefix, GetFieldHints.Handler handler, CancellationToken ct) =>
            {
                if (!Enum.TryParse<HintField>(field, ignoreCase: true, out var hintField) || !Enum.IsDefined(hintField))
                    throw AppException.Invalid("field", "field must be labels or version.");
                return TypedResults.Ok(await handler.HandleAsync(new GetFieldHints.Query(projectKeyOrId, hintField, prefix), ct));
            })
            .WithSummary("Up to 20 previously used Labels or Version values, most recent first, filtered by prefix.")
            .ProducesProblem(StatusCodes.Status404NotFound);
    }

    private static void MapTickets(RouteGroupBuilder ticket)
    {
        ticket.MapGet("", async (string keyOrId, string[]? include, GetTicket.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var dto = await handler.HandleAsync(new GetTicket.Query(keyOrId, GetTicket.Handler.ParseIncludes(include)), ct);
                response.SetRowVersion(dto.RowVersion);
                return TypedResults.Ok(dto);
            })
            .WithSummary("A ticket with children and progress, links, the latest 50 comments, test cases and watchers (include= narrows them).")
            .ProducesProblem(StatusCodes.Status404NotFound);

        ticket.MapPatch("", async (string keyOrId, UpdateTicket.Command command, UpdateTicket.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var dto = await handler.HandleAsync(command with { KeyOrId = keyOrId, ExpectedVersion = request.ExpectedRowVersion() }, ct);
                request.HttpContext.Response.SetRowVersion(dto.RowVersion);
                return TypedResults.Ok(dto);
            })
            .WithSummary("Updates any editable field; omitted fields stay, null clears. If-Match is optional (D-43).")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        ticket.MapDelete("", async (string keyOrId, DeleteTicket.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new DeleteTicket.Command(keyOrId), ct);
                return TypedResults.NoContent();
            })
            .WithSummary("Soft-deletes a ticket (Owner only). Fails with ticket.hasChildren while it has children.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);

        ticket.MapPost("/restore", async (string keyOrId, RestoreTicket.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var dto = await handler.HandleAsync(new RestoreTicket.Command(keyOrId), ct);
                response.SetRowVersion(dto.RowVersion);
                return TypedResults.Ok(dto);
            })
            .WithSummary($"Undoes a delete within {Ticket.RestoreWindowMinutes} minutes (Owner only): the ticket, its links, test cases and placement come back. "
                + "Fails with ticket.notDeleted or ticket.restore.expired.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        ticket.MapGet("/children/graph", async (string keyOrId, GetChildrenGraph.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new GetChildrenGraph.Query(keyOrId), ct)))
            .WithSummary("The children of a ticket as a graph: nodes (children, plus readable linked tickets outside the parent as external nodes, "
                + "with a blocked flag) and edges (links between them; Blocks goes from the blocking ticket).")
            .ProducesProblem(StatusCodes.Status404NotFound);

        ticket.MapGet("/history", async (string keyOrId, int? limit, string? cursor, GetTicketHistory.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new GetTicketHistory.Query(keyOrId, new PageRequest(limit, cursor)), ct)))
            .WithSummary("Activity entries of the ticket, newest first.");

        ticket.MapPost("/links", async (string keyOrId, LinkTickets.Command command, LinkTickets.Handler handler, CancellationToken ct) =>
            {
                var link = await handler.HandleAsync(command with { SourceKeyOrId = keyOrId }, ct);
                return TypedResults.Created($"/api/v1/tickets/{keyOrId}/links/{link.Id}", link);
            })
            .WithSummary("Links this ticket to another (Blocks, RelatesTo, Duplicates).")
            .ProducesProblem(StatusCodes.Status409Conflict);

        ticket.MapDelete("/links/{linkId:guid}", async (string keyOrId, Guid linkId, UnlinkTickets.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new UnlinkTickets.Command(keyOrId, linkId), ct);
                return TypedResults.NoContent();
            })
            .WithSummary("Removes a link of this ticket.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        ticket.MapGet("/comments", async (string keyOrId, int? limit, string? cursor, ListComments.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new ListComments.Query(keyOrId, new PageRequest(limit, cursor)), ct)))
            .WithSummary("Comments, oldest first. Deleted comments are placeholders with deleted = true.");

        ticket.MapPost("/comments", async (string keyOrId, AddComment.Command command, AddComment.Handler handler, CancellationToken ct) =>
            {
                var comment = await handler.HandleAsync(command with { TicketKeyOrId = keyOrId }, ct);
                return TypedResults.Created($"/api/v1/comments/{comment.Id}", comment);
            })
            .WithSummary("Adds a markdown comment.")
            .ProducesProblem(StatusCodes.Status400BadRequest);
    }

    private static void MapComments(RouteGroupBuilder comment)
    {
        comment.MapPatch("", async (Guid commentId, UpdateComment.Command command, UpdateComment.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(command with { CommentId = commentId }, ct)))
            .WithSummary("Edits your own comment; the previous body stays in the ticket history.")
            .ProducesProblem(StatusCodes.Status403Forbidden);

        comment.MapDelete("", async (Guid commentId, DeleteComment.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new DeleteComment.Command(commentId), ct)))
            .WithSummary("Deletes your own comment (Owners: any comment). Returns the placeholder.")
            .ProducesProblem(StatusCodes.Status403Forbidden);
    }
}
