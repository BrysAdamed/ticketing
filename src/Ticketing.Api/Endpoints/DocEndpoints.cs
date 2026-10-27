using Microsoft.Net.Http.Headers;
using Ticketing.Api.Http;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Domain.Docs;

namespace Ticketing.Api.Endpoints;

/// <summary>Project docs (spec 1.14): tree, recent, trash and create per project; one doc by key (<c>WEB-D-12</c>) or id; a version; markdown export; my draft.</summary>
public sealed class DocEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        MapProjectScoped(api.MapGroup("/projects/{projectKeyOrId}/docs").WithTags("Docs"));
        MapDocs(api.MapGroup("/docs/{keyOrId}").WithTags("Docs"));
    }

    private static void MapProjectScoped(RouteGroupBuilder docs)
    {
        docs.MapGet("/tree", async (
                string projectKeyOrId, string? folder, int? depth, DocKind[]? kind, GetDocTree.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new GetDocTree.Query(projectKeyOrId, folder, depth, kind), ct)))
            .WithSummary("The whole docs tree (at most 5 000 nodes, unpaged), depth-first in manual order, without content. "
                + "folder (key or path), depth and kind (repeatable) narrow it.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        docs.MapGet("/recent", async (string projectKeyOrId, int? limit, GetRecentDocs.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new GetRecentDocs.Query(projectKeyOrId, limit), ct)))
            .WithSummary("The most recently updated pages and diagrams (limit 1..50, default 10).")
            .ProducesProblem(StatusCodes.Status404NotFound);

        docs.MapGet("/by-path", async (string projectKeyOrId, string path, GetDoc.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var dto = await handler.HandleAsync(new GetDoc.Query(null, projectKeyOrId, path), ct);
                response.SetRowVersion(dto.RowVersion);
                return TypedResults.Ok(dto);
            })
            .WithSummary(@"A doc by path: titles joined by '/', case-insensitive; a '/' inside a title is written '\/'.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        docs.MapGet("/trash", async (string projectKeyOrId, int? limit, string? cursor, ListDocTrash.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new ListDocTrash.Query(projectKeyOrId, new PageRequest(limit, cursor)), ct)))
            .WithSummary("Deleted docs, one entry per delete group, newest first (project Owners only).")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        docs.MapPost("", async (string projectKeyOrId, CreateDoc.Command command, CreateDoc.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var dto = await handler.HandleAsync(command with { ProjectKeyOrId = projectKeyOrId, IdempotencyKey = request.IdempotencyKeyHeader() }, ct);
                request.HttpContext.Response.SetRowVersion(dto.RowVersion);
                return TypedResults.Created($"/api/v1/docs/{dto.Key}", dto);
            })
            .WithSummary("Creates a folder, page or diagram in the root or a folder (parent: key, path or root), at the bottom by default, "
                + "the Top, or before/after a sibling. Pages and diagrams start at version 1. Accepts an Idempotency-Key header.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }

    private static void MapDocs(RouteGroupBuilder doc)
    {
        doc.MapGet("", async (string keyOrId, GetDoc.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var dto = await handler.HandleAsync(new GetDoc.Query(keyOrId), ct);
                response.SetRowVersion(dto.RowVersion);
                return TypedResults.Ok(dto);
            })
            .WithSummary("A doc with its latest content, path, breadcrumb, other editors, my draft marker and permissions; folders list their children.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        doc.MapPatch("", async (string keyOrId, UpdateDoc.Command command, UpdateDoc.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var dto = await handler.HandleAsync(command with { KeyOrId = keyOrId, ExpectedVersion = request.ExpectedRowVersion() }, ct);
                request.HttpContext.Response.SetRowVersion(dto.RowVersion);
                return TypedResults.Ok(dto);
            })
            .WithSummary("Renames and/or publishes new content. content requires baseVersion; a stale one is 409 doc.version.conflict "
                + "with currentVersion, updatedBy and updatedAt. A rename alone creates no version.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        doc.MapPost("/edits", async (string keyOrId, EditDoc.Command command, EditDoc.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var dto = await handler.HandleAsync(command with { KeyOrId = keyOrId }, ct);
                response.SetRowVersion(dto.RowVersion);
                return TypedResults.Ok(dto);
            })
            .WithSummary("Applies 1..50 find/replace edits to the latest version, in order, all or nothing (doc.edit.noMatch, doc.edit.ambiguous).")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);

        doc.MapPost("/move", async (string keyOrId, MoveDoc.Command command, MoveDoc.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var dto = await handler.HandleAsync(command with { KeyOrId = keyOrId }, ct);
                response.SetRowVersion(dto.RowVersion);
                return TypedResults.Ok(dto);
            })
            .WithSummary("Moves a doc (a folder with its subtree) to parent (key, path or root; omitted keeps the folder) at a position, "
                + "or before/after a sibling.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);

        doc.MapPost("/duplicate", async (string keyOrId, DuplicateDoc.Handler handler, CancellationToken ct) =>
            {
                var dto = await handler.HandleAsync(new DuplicateDoc.Command(keyOrId), ct);
                return TypedResults.Created($"/api/v1/docs/{dto.Key}", dto);
            })
            .WithSummary("Copies a page or diagram next to it as \"Copy of …\" at version 1.")
            .ProducesProblem(StatusCodes.Status409Conflict);

        doc.MapDelete("", async (string keyOrId, DeleteDoc.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new DeleteDoc.Command(keyOrId), ct)))
            .WithSummary("Soft-deletes a doc, a folder with its subtree. Owners: anything; Members: their own docs and empty folders.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);

        doc.MapPost("/restore", async (string keyOrId, RestoreDoc.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var dto = await handler.HandleAsync(new RestoreDoc.Command(keyOrId), ct);
                response.SetRowVersion(dto.RowVersion);
                return TypedResults.Ok(dto);
            })
            .WithSummary($"Restores a deleted doc with everything deleted with it: the deleter within {DocNode.RestoreWindowMinutes} minutes, "
                + "Owners at any time. A title clash appends \" (restored)\".")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);

        doc.MapGet("/versions/{number:int}", async (string keyOrId, int number, GetDocVersion.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new GetDocVersion.Query(keyOrId, number), ct)))
            .WithSummary("One published version with its full content; 404 doc.version.notFound when the doc has no such version.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        doc.MapGet("/export.md", async (string keyOrId, ExportDocMarkdown.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var file = await handler.HandleAsync(new ExportDocMarkdown.Query(keyOrId), ct);
                var disposition = new ContentDispositionHeaderValue("attachment");
                disposition.SetHttpFileName(file.FileName);
                response.Headers.ContentDisposition = disposition.ToString();
                response.Headers.XContentTypeOptions = "nosniff";
                return TypedResults.Text(file.Content, "text/markdown; charset=utf-8");
            })
            .WithSummary("Downloads the latest markdown of a page as '{title}.md'. Readers can export, archived projects included.")
            .Produces<string>(StatusCodes.Status200OK, "text/markdown")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        doc.MapGet("/draft", async (string keyOrId, GetMyDocDraft.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new GetMyDocDraft.Query(keyOrId), ct)))
            .WithSummary("My unpublished draft of the doc; 404 doc.draft.notFound when I have none.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        doc.MapPut("/draft", async (string keyOrId, SaveMyDocDraft.Command command, SaveMyDocDraft.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(command with { KeyOrId = keyOrId }, ct)))
            .WithSummary("Creates or replaces my draft (baseVersion, title, content). Never visible to others.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);

        doc.MapDelete("/draft", async (string keyOrId, DiscardMyDocDraft.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new DiscardMyDocDraft.Command(keyOrId), ct);
                return TypedResults.NoContent();
            })
            .WithSummary("Discards my draft (no-op when there is none).");
    }
}
