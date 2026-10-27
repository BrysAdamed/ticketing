using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Comments;

namespace Ticketing.Application.Comments;

/// <summary>The author edits their doc comment; the previous body is kept in the doc's activity (spec 6.9).</summary>
public static class UpdateDocComment
{
    public const string Action = "doc.comment.edited";

    public sealed record Command(string Body, [property: JsonIgnore] Guid CommentId = default) : IValidatable
    {
        public void Validate(Validator validator) => validator.Required("body", Body, Comment.BodyMaxLength);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, DocCommentDto>
    {
        public async Task<DocCommentDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var (comment, doc) = await DocCommentLookup.WriteAsync(db, access, command.CommentId, cancellationToken);
            var previous = comment.EditBy(currentUser.Id, command.Body, clock.Now);
            activity.RecordChange(
                ActivityEntityType.Doc, doc.Id, doc.ProjectId, Action, UpdateComment.Field,
                new { commentId = comment.Id, body = (string?)previous }, new { commentId = comment.Id, body = (string?)null });
            await db.SaveChangesAsync(cancellationToken);
            return await DocCommentQueries.OneAsync(db, currentUser, doc, comment.Id, cancellationToken);
        }
    }
}
