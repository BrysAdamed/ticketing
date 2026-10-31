using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Collaboration;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Comments;

namespace Ticketing.Application.Comments;

/// <summary>
/// Adds a comment to the footer thread of a page or diagram (docs refinement D12). Writers comment; the doc itself is left
/// untouched (no version, same <c>updatedAt</c>). The doc's watchers are notified and the author starts watching; newly mentioned users are notified with <c>Mentioned</c> instead
/// and start watching too (D-94, D-96, D-162, D-163, through activity).
/// </summary>
public static class AddDocComment
{
    public const string Action = "doc.comment.added";

    public sealed record Command(string Body, [property: JsonIgnore] string DocKeyOrId = "") : IValidatable
    {
        public void Validate(Validator validator) => validator.Required("body", Body, Comment.BodyMaxLength);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity,
        MentionNormalizer mentions) : IHandler<Command, DocCommentDto>
    {
        public async Task<DocCommentDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var doc = await DocLookup.WriteAsync(db, access, command.DocKeyOrId, cancellationToken);
            DocCommentQueries.EnsureCommentable(doc);
            var body = await mentions.NormalizeAsync(doc.Grant, null, command.Body, "body", cancellationToken);
            var comment = Comment.CreateForDoc(doc.Id, currentUser.Id, body!, clock.Now);
            db.Comments.Add(comment);
            activity.Record(ActivityEntityType.Doc, doc.Id, doc.ProjectId, Action, new { commentId = comment.Id });
            await db.SaveChangesAsync(cancellationToken);
            return await DocCommentQueries.OneAsync(db, currentUser, doc, comment.Id, cancellationToken);
        }
    }
}
