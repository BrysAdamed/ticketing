using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Collaboration;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Comments;

namespace Ticketing.Application.Comments;

public static class AddComment
{
    public const string Action = "comment.added";

    public sealed record Command(string Body, [property: JsonIgnore] string TicketKeyOrId = "") : IValidatable
    {
        public void Validate(Validator validator) => validator.Required("body", Body, Comment.BodyMaxLength);
    }

    public sealed class Handler(
        ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity, MentionNormalizer mentions)
        : IHandler<Command, CommentDto>
    {
        public async Task<CommentDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var target = await TicketLookup.WriteAsync(db, access, command.TicketKeyOrId, cancellationToken);
            var body = await mentions.NormalizeAsync(target.Grant, null, command.Body, "body", cancellationToken);
            var now = clock.Now;
            var comment = Comment.Create(target.Id, currentUser.Id, body!, now);
            await db.InTransactionAsync(async ct =>
            {
                db.Comments.Add(comment);
                activity.Record(ActivityEntityType.Ticket, target.Id, target.ProjectId, Action, new { commentId = comment.Id });
                await db.SaveChangesAsync(ct);
                await db.TouchTicketAsync(target.Id, now, ct);
                return true;
            }, cancellationToken);
            return await CommentQueries.OneAsync(db, currentUser, target.Grant, comment.Id, cancellationToken);
        }
    }
}
