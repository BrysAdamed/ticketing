using Ticketing.Application.Comments;
using Ticketing.Application.Common;

namespace Ticketing.Api.Endpoints;

/// <summary>The footer comment thread of pages and diagrams (docs refinement D12): list and add per doc, edit and delete by comment id.</summary>
public sealed class DocCommentEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var doc = api.MapGroup("/docs/{keyOrId}/comments").WithTags("Docs");
        doc.MapGet("", async (string keyOrId, int? limit, string? cursor, ListDocComments.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new ListDocComments.Query(keyOrId, new PageRequest(limit, cursor)), ct)))
            .WithSummary("Comments of a page or diagram, oldest first; deleted comments are placeholders with deleted = true. Folders have none.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        doc.MapPost("", async (string keyOrId, AddDocComment.Command command, AddDocComment.Handler handler, CancellationToken ct) =>
            {
                var comment = await handler.HandleAsync(command with { DocKeyOrId = keyOrId }, ct);
                return TypedResults.Created($"/api/v1/docs/comments/{comment.Id}", comment);
            })
            .WithSummary("Adds a markdown comment to a page or diagram (folders: 409 doc.kind.unsupported).")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        var comment = api.MapGroup("/docs/comments/{commentId:guid}").WithTags("Docs");
        comment.MapPatch("", async (Guid commentId, UpdateDocComment.Command command, UpdateDocComment.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(command with { CommentId = commentId }, ct)))
            .WithSummary("Edits your own doc comment; the previous body stays in the doc's activity.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        comment.MapDelete("", async (Guid commentId, DeleteDocComment.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new DeleteDocComment.Command(commentId), ct)))
            .WithSummary("Deletes your own doc comment (Owners: any comment). Returns the placeholder.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }
}
