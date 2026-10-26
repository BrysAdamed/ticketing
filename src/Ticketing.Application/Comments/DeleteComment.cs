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
                comment.DeleteBy(currentUser.Id, target.Grant.IsOwner, clock.Now);
                activity.Record(ActivityEntityType.Ticket, target.Id, target.ProjectId, "comment.deleted", new { commentId = comment.Id });
                (await db.Tickets.SingleAsync(t => t.Id == target.Id, cancellationToken)).Touch(clock.Now);
                await db.SaveChangesAsync(cancellationToken);
            }
            return await CommentQueries.OneAsync(db, currentUser, target.Grant, comment.Id, cancellationToken);
        }
    }
}
