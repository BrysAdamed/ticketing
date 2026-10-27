using Microsoft.Net.Http.Headers;
using Ticketing.Application.Attachments;
using Ticketing.Application.Common;
using Ticketing.Domain.Attachments;

namespace Ticketing.Api.Endpoints;

/// <summary>
/// Ticket and page attachments (spec 4.8, docs refinement 1.3). Downloads send <c>nosniff</c> and a sandboxing CSP; images
/// are inline, everything else is a download. Content is immutable per id, so browsers may cache it privately.
/// </summary>
public sealed class AttachmentEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var ticket = api.MapGroup("/tickets/{keyOrId}/attachments").WithTags("Attachments");

        ticket.MapGet("", async (string keyOrId, ListAttachments.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListAttachments.Query(keyOrId), ct)))
            .WithSummary("Attachments of a ticket, oldest first.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        ticket.MapPost("", async (string keyOrId, HttpRequest request, UploadAttachment.Handler handler, CancellationToken ct) =>
            {
                var file = await ReadFileAsync(request, ct);
                var attachment = await handler.HandleAsync(new UploadAttachment.Command(keyOrId, file.FileName, file.ContentType, file.Content), ct);
                return TypedResults.Created(attachment.Url, attachment);
            })
            .DisableAntiforgery()
            .Accepts<IFormFile>("multipart/form-data")
            .WithSummary("Uploads one file (multipart field 'file'): PNG, JPEG, GIF, WebP, PDF, text, CSV, JSON or ZIP, up to 10 MiB, 50 per ticket.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        var doc = api.MapGroup("/docs/{keyOrId}/attachments").WithTags("Attachments");

        doc.MapGet("", async (string keyOrId, ListDocAttachments.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListDocAttachments.Query(keyOrId), ct)))
            .WithSummary("Attachments of a page, oldest first.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        doc.MapPost("", async (string keyOrId, HttpRequest request, UploadDocAttachment.Handler handler, CancellationToken ct) =>
            {
                var file = await ReadFileAsync(request, ct);
                var attachment = await handler.HandleAsync(new UploadDocAttachment.Command(keyOrId, file.FileName, file.ContentType, file.Content), ct);
                return TypedResults.Created(attachment.Url, attachment);
            })
            .DisableAntiforgery()
            .Accepts<IFormFile>("multipart/form-data")
            .WithSummary("Uploads one file to a page (multipart field 'file'): the ticket attachment types, up to 10 MiB, 200 per page. "
                + "Creates no version.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        var attachments = api.MapGroup("/attachments/{attachmentId:guid}").WithTags("Attachments");

        attachments.MapGet("", async (Guid attachmentId, bool? download, GetAttachmentContent.Handler handler, HttpContext context, CancellationToken ct) =>
            {
                var file = await handler.HandleAsync(new GetAttachmentContent.Query(attachmentId), ct);
                var etag = new EntityTagHeaderValue($"\"{file.Sha256}\"");
                var headers = context.Response.Headers;
                headers.XContentTypeOptions = "nosniff";
                headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
                headers.CacheControl = "private, max-age=86400";
                var disposition = new ContentDispositionHeaderValue(file.IsImage && download != true ? "inline" : "attachment");
                disposition.SetHttpFileName(file.FileName);
                headers.ContentDisposition = disposition.ToString();
                return TypedResults.Stream(file.Content, file.ContentType, entityTag: etag);
            })
            .WithSummary("Downloads the content. Images are served inline unless download=true; other types always as attachment.")
            .Produces(StatusCodes.Status200OK, contentType: "application/octet-stream")
            .ProducesProblem(StatusCodes.Status404NotFound);

        attachments.MapDelete("", async (Guid attachmentId, DeleteAttachment.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new DeleteAttachment.Command(attachmentId), ct);
                return TypedResults.NoContent();
            })
            .WithSummary("Deletes an attachment and its content (uploader or project Owner).")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }

    private static async Task<UploadedFile> ReadFileAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (!request.HasFormContentType)
            throw AppException.Invalid("file", "Send the file as multipart/form-data in a field named 'file'.");
        var form = await request.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file") ?? throw AppException.Invalid("file", "Send the file in a multipart field named 'file'.");
        if (file.Length > Attachment.MaxSizeBytes)
            throw new AppException(ErrorKind.Validation, AttachmentErrors.SizeInvalid, "Files must be between 1 byte and 10 MiB.");

        var content = new byte[file.Length];
        await using var stream = file.OpenReadStream();
        await stream.ReadExactlyAsync(content, cancellationToken);
        return new UploadedFile(file.FileName, file.ContentType, content);
    }

    private sealed record UploadedFile(string FileName, string? ContentType, byte[] Content);
}
