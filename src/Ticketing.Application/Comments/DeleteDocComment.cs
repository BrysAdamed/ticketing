using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.Comments;

/// <summary>The author deletes their own doc comment, Owners delete any; the body is cleared and a placeholder stays in order (spec 6.9).</summary>
public static class DeleteDocComment
{
    public const string Action = "doc.comment.deleted";

    public sealed record Command(Guid CommentId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, DocCommentDto>
    {
        public async Task<DocCommentDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var (comment, doc) = await DocCommentLookup.WriteAsync(db, access, command.CommentId, cancellationToken);
            if (!comment.IsDeleted)
            {
                comment.DeleteBy(currentUser.Id, doc.Grant.IsOwner, clock.Now);
                activity.Record(ActivityEntityType.Doc, doc.Id, doc.ProjectId, Action, new { commentId = comment.Id });
                await db.SaveChangesAsync(cancellationToken);
            }
            return await DocCommentQueries.OneAsync(db, currentUser, doc, comment.Id, cancellationToken);
        }
    }
}
