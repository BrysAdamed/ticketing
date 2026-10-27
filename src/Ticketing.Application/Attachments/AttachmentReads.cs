using System.Text;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Attachments;

namespace Ticketing.Application.Attachments;

/// <summary>Attachments of a ticket, oldest first (at most 50, so not paged).</summary>
public static class ListAttachments
{
    public sealed record Query(string TicketKeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, IReadOnlyList<AttachmentDto>>
    {
        public async Task<IReadOnlyList<AttachmentDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.ReadAsync(db, access, request.TicketKeyOrId, cancellationToken);
            return await AttachmentQueries.ListAsync(db, currentUser, target.Grant, target.Id, null, cancellationToken);
        }
    }
}

/// <summary>Attachments of a doc, oldest first (at most 200 per page, so not paged); folders and diagrams have none.</summary>
public static class ListDocAttachments
{
    public sealed record Query(string DocKeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, IReadOnlyList<DocAttachmentDto>>
    {
        public async Task<IReadOnlyList<DocAttachmentDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await DocLookup.ReadAsync(db, access, request.DocKeyOrId, cancellationToken);
            return await AttachmentQueries.ListForDocAsync(db, currentUser, target.Grant, target.Id, target.Key, null, cancellationToken);
        }
    }
}

/// <summary>The bytes of an attachment the caller can read.</summary>
public static class GetAttachmentContent
{
    public sealed record Query(Guid AttachmentId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, IAttachmentStore store) : IHandler<Query, AttachmentFile>
    {
        public async Task<AttachmentFile> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await AttachmentQueries.ReadAsync(db, access, request.AttachmentId, cancellationToken);
            var content = await store.OpenReadAsync(target.Id, cancellationToken) ?? throw AttachmentQueries.NotFound();
            return new AttachmentFile(target.FileName, target.ContentType, target.SizeBytes, target.Sha256, content);
        }
    }
}

/// <summary>The bytes of an attachment; the caller disposes <see cref="Content"/>.</summary>
public sealed record AttachmentFile(string FileName, string ContentType, int SizeBytes, string Sha256, Stream Content)
{
    public bool IsImage => ContentType.StartsWith("image/", StringComparison.Ordinal);
}

/// <summary>Text content of <c>text/*</c> and JSON attachments for LLM clients (spec 9.3), up to 200 KB.</summary>
public static class GetAttachmentText
{
    public const int MaxBytes = 200 * 1024;

    public sealed record Query(Guid AttachmentId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, IAttachmentStore store) : IHandler<Query, AttachmentTextDto>
    {
        public async Task<AttachmentTextDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await AttachmentQueries.ReadAsync(db, access, request.AttachmentId, cancellationToken);
            if (!AttachmentContentType.IsText(target.ContentType))
                throw new AppException(ErrorKind.Validation, AttachmentErrors.NotText,
                    $"{target.FileName} is {target.ContentType}; only text, CSV and JSON attachments can be read as text.",
                    "Use the download URL from list_attachments or list_doc_attachments for binary files.");

            await using var content = await store.OpenReadAsync(target.Id, cancellationToken) ?? throw AttachmentQueries.NotFound();
            var buffer = new byte[Math.Min(target.SizeBytes, MaxBytes)];
            var read = await content.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, cancellationToken);
            var text = new UTF8Encoding(false).GetString(buffer, 0, read).TrimStart('﻿');
            var truncated = target.SizeBytes > MaxBytes;
            if (truncated)
                text = text.TrimEnd('�');
            return new AttachmentTextDto(target.Id, target.FileName, target.ContentType, target.SizeBytes, text, truncated);
        }
    }
}

public sealed record AttachmentTextDto(Guid Id, string FileName, string ContentType, int SizeBytes, string Text, bool Truncated);
