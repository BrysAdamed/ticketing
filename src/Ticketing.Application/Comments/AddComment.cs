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
            var ticket = await db.Tickets.SingleAsync(t => t.Id == target.Id, cancellationToken);
            var comment = Comment.Create(target.Id, currentUser.Id, body!, clock.Now);
            db.Comments.Add(comment);
            ticket.Touch(clock.Now);
            activity.Record(ActivityEntityType.Ticket, target.Id, target.ProjectId, Action, new { commentId = comment.Id });
            await db.SaveChangesAsync(cancellationToken);
            return await CommentQueries.OneAsync(db, currentUser, target.Grant, comment.Id, cancellationToken);
        }
    }
}
