using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.Comments;

/// <summary>The author deletes their own comment, Owners delete any; the body is cleared and a placeholder stays in order (spec 6.9).</summary>
public static class DeleteComment
{
    public sealed record Command(Guid CommentId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, CommentDto>
    {
        public async Task<CommentDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var (comment, target) = await CommentLookup.WriteAsync(db, access, command.CommentId, cancellationToken);
            if (!comment.IsDeleted)
            {
                var now = clock.Now;
                comment.DeleteBy(currentUser.Id, target.Grant.IsOwner, now);
                activity.Record(ActivityEntityType.Ticket, target.Id, target.ProjectId, "comment.deleted", new { commentId = comment.Id });
                await db.InTransactionAsync(async ct =>
                {
                    await db.SaveChangesAsync(ct);
                    await db.TouchTicketAsync(target.Id, now, ct);
                    return true;
                }, cancellationToken);
            }
            return await CommentQueries.OneAsync(db, currentUser, target.Grant, comment.Id, cancellationToken);
        }
    }
}
