using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Attachments;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Attachments;

/// <summary>
/// Uploads a file to a page (docs refinement 1.3, 1.8): the ticket rules (write access, allow-listed and sniffed type, 1 byte..10 MiB)
/// with at most 200 per page. The page row is locked while counting. Uploading creates no version and leaves the page untouched.
/// </summary>
public static class UploadDocAttachment
{
    public const string Action = "doc.attachment.added";

    public sealed record Command(string DocKeyOrId, string FileName, string? ContentType, ReadOnlyMemory<byte> Content);

    public sealed class Handler(
        ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity, IAttachmentStore store)
        : IHandler<Command, DocAttachmentDto>
    {
        public async Task<DocAttachmentDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await DocLookup.WriteAsync(db, access, command.DocKeyOrId, cancellationToken);
            if (target.Kind != DocKind.Page)
                throw AppException.Conflict(
                    DocErrors.KindUnsupported, $"{target.Key} is a {target.Kind.ToString().ToLowerInvariant()}; only pages have attachments.", "Pass a page key.");
            var fileName = Attachment.SanitizeFileName(command.FileName);
            if (command.Content.Length is < 1 or > Attachment.MaxSizeBytes)
                throw new AppException(ErrorKind.Validation, AttachmentErrors.SizeInvalid, "Files must be between 1 byte and 10 MiB.");
            var contentType = AttachmentContentType.Resolve(command.ContentType, fileName, command.Content.Span);
            var sha256 = Convert.ToHexStringLower(SHA256.HashData(command.Content.Span));

            var id = await db.InTransactionAsync(async ct =>
            {
                var node = await DocTree.LockNodeAsync(db, target.Id, ct);
                var count = await db.Attachments.CountAsync(a => a.DocNodeId == node.Id, ct);
                if (count >= Attachment.MaxPerDoc)
                    throw AppException.Conflict(
                        AttachmentErrors.LimitReached, $"{target.Key} already has {Attachment.MaxPerDoc} attachments.", "Delete an attachment first.");

                var attachment = Attachment.CreateForDoc(node.Id, fileName, contentType, command.Content.Length, sha256, currentUser.Id, clock.Now);
                db.Attachments.Add(attachment);
                await store.SaveAsync(attachment.Id, command.Content, ct);
                activity.Record(ActivityEntityType.Doc, node.Id, target.ProjectId, Action, new { attachmentId = attachment.Id, fileName = attachment.FileName });
                await db.SaveChangesAsync(ct);
                return attachment.Id;
            }, cancellationToken);

            return (await AttachmentQueries.ListForDocAsync(db, currentUser, target.Grant, target.Id, target.Key, id, cancellationToken))[0];
        }
    }
}
