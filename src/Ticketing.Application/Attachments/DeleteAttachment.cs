using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Attachments;

namespace Ticketing.Application.Attachments;

/// <summary>Deletes an attachment and its content (spec 4.8, 5.3): the uploader with write access, or a project Owner.</summary>
public static class DeleteAttachment
{
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
                var ticket = await db.Tickets.SingleAsync(t => t.Id == target.TicketId, ct);
                await store.DeleteAsync(target.Id, ct);
                await db.Attachments.Where(a => a.Id == target.Id).ExecuteDeleteAsync(ct);
                ticket.Touch(clock.Now);
                activity.Record(ActivityEntityType.Ticket, target.TicketId, target.ProjectId, "attachment.removed",
                    new { attachmentId = target.Id, fileName = target.FileName });
                await db.SaveChangesAsync(ct);
                return true;
            }, cancellationToken);
        }
    }
}
