using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;

namespace Ticketing.Application.Comments;

/// <summary>Comments of a ticket, oldest first (spec 4.7, 6.9). Deleted comments stay in order as placeholders.</summary>
public static class ListComments
{
    public sealed record Query(string TicketKeyOrId, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, CursorPage<CommentDto>>
    {
        public async Task<CursorPage<CommentDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.ReadAsync(db, access, request.TicketKeyOrId, cancellationToken);
            return await CommentQueries.PageAsync(db, currentUser, target.Grant, target.Id, request.Page ?? new PageRequest(), cancellationToken);
        }
    }
}
