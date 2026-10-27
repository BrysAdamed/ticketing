using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Comments;

/// <summary>The comment thread of a page or diagram, oldest first; folders have none (an empty page). Deleted comments stay as placeholders.</summary>
public static class ListDocComments
{
    public sealed record Query(string DocKeyOrId, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, CursorPage<DocCommentDto>>
    {
        public async Task<CursorPage<DocCommentDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var doc = await DocLookup.ReadAsync(db, access, request.DocKeyOrId, cancellationToken);
            if (doc.Kind == DocKind.Folder)
                return new CursorPage<DocCommentDto>([], null);
            return await DocCommentQueries.PageAsync(db, currentUser, doc, request.Page ?? new PageRequest(), cancellationToken);
        }
    }
}
