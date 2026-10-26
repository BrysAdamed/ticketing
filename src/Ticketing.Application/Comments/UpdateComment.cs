using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Comments;

namespace Ticketing.Application.Comments;

/// <summary>The author edits their comment; the previous body is kept in the ticket history (spec 6.9).</summary>
public static class UpdateComment
{
    public sealed record Command(string Body, [property: JsonIgnore] Guid CommentId = default) : IValidatable
    {
        public void Validate(Validator validator) => validator.Required("body", Body, Comment.BodyMaxLength);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, CommentDto>
    {
        public async Task<CommentDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var (comment, target) = await CommentLookup.WriteAsync(db, access, command.CommentId, cancellationToken);
            var previous = comment.EditBy(currentUser.Id, command.Body, clock.Now);
            activity.RecordChange(
                ActivityEntityType.Ticket, target.Id, target.ProjectId, "comment.edited", "comment",
                new { commentId = comment.Id, body = previous }, new { commentId = comment.Id, body = comment.Body });
            (await db.Tickets.SingleAsync(t => t.Id == target.Id, cancellationToken)).Touch(clock.Now);
            await db.SaveChangesAsync(cancellationToken);
            return await CommentQueries.OneAsync(db, currentUser, target.Grant, comment.Id, cancellationToken);
        }
    }
}
