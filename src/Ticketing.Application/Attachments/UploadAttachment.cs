using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Attachments;

namespace Ticketing.Application.Attachments;

/// <summary>
/// Uploads a file to a ticket (spec 4.8, I-07): write access, allow-listed and sniffed type, 1 byte..10 MiB, at most 50
/// per ticket. The ticket row is locked while counting, so parallel uploads cannot pass the limit.
/// </summary>
public static class UploadAttachment
{
    public sealed record Command(string TicketKeyOrId, string FileName, string? ContentType, ReadOnlyMemory<byte> Content);

    public sealed class Handler(
        ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity, IAttachmentStore store)
        : IHandler<Command, AttachmentDto>
    {
        public async Task<AttachmentDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.WriteAsync(db, access, command.TicketKeyOrId, cancellationToken);
            var fileName = Attachment.SanitizeFileName(command.FileName);
            if (command.Content.Length is < 1 or > Attachment.MaxSizeBytes)
                throw new AppException(ErrorKind.Validation, AttachmentErrors.SizeInvalid, "Files must be between 1 byte and 10 MiB.");
            var contentType = AttachmentContentType.Resolve(command.ContentType, fileName, command.Content.Span);
            var sha256 = Convert.ToHexStringLower(SHA256.HashData(command.Content.Span));

            var id = await db.InTransactionAsync(async ct =>
            {
                var ticketId = target.Id;
                var ticket = await db.Tickets.FromSql($"SELECT *, xmin FROM tickets WHERE id = {ticketId} FOR UPDATE").SingleAsync(ct);
                var count = await db.Attachments.CountAsync(a => a.TicketId == ticketId, ct);
                if (count >= Attachment.MaxPerTicket)
                    throw AppException.Conflict(
                        AttachmentErrors.LimitReached, $"{target.Key} already has {Attachment.MaxPerTicket} attachments.", "Delete an attachment first.");

                var attachment = Attachment.Create(ticketId, fileName, contentType, command.Content.Length, sha256, currentUser.Id, clock.Now);
                db.Attachments.Add(attachment);
                await store.SaveAsync(attachment.Id, command.Content, ct);
                ticket.Touch(clock.Now);
                activity.Record(ActivityEntityType.Ticket, ticketId, target.ProjectId, "attachment.added",
                    new { attachmentId = attachment.Id, fileName = attachment.FileName });
                await db.SaveChangesAsync(ct);
                return attachment.Id;
            }, cancellationToken);

            return (await AttachmentQueries.ListAsync(db, currentUser, target.Grant, target.Id, id, cancellationToken))[0];
        }
    }
}
