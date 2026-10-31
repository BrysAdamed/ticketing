using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Attachments;

namespace Ticketing.Application.Attachments;

/// <summary>
/// Deletes an attachment and its content (spec 4.8, 5.3; docs refinement 1.5): the uploader with write access, or a project
/// Owner. A ticket attachment touches the ticket; a doc attachment leaves the doc as it is.
/// </summary>
public static class DeleteAttachment
{
    public const string DocAction = "doc.attachment.deleted";

    public sealed record Command(Guid AttachmentId);

    public sealed class Handler(
        ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity, IAttachmentStore store)
        : IHandler<Command, bool>
    {
        public async Task<bool> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await AttachmentQueries.ReadAsync(db, access, command.AttachmentId, cancellationToken);
            var grant = await access.EnsureCanWriteAsync(target.ProjectId, cancellationToken);
            if (!grant.IsOwner && target.UploadedById != currentUser.Id)
                throw AppException.Forbidden(AttachmentErrors.Forbidden, "Only the uploader or a project Owner can delete this attachment.");

            return await db.InTransactionAsync(async ct =>
            {
                await store.DeleteAsync(target.Id, ct);
                await db.Attachments.Where(a => a.Id == target.Id).ExecuteDeleteAsync(ct);
                var details = new { attachmentId = target.Id, fileName = target.FileName };
                if (target.TicketId is { } ticketId)
                {
                    activity.Record(ActivityEntityType.Ticket, ticketId, target.ProjectId, "attachment.removed", details);
                    await db.SaveChangesAsync(ct);
                    await db.TouchTicketAsync(ticketId, clock.Now, ct);
                }
                else
                {
                    activity.Record(ActivityEntityType.Doc, target.DocNodeId!.Value, target.ProjectId, DocAction, details);
                    await db.SaveChangesAsync(ct);
                }
                return true;
            }, cancellationToken);
        }
    }
}
