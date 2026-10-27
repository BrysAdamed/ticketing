using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>The caller's own draft of a page or diagram (spec 1.6); nobody else can read it.</summary>
public static class GetMyDocDraft
{
    public sealed record Query(string KeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, DocDraftDto>
    {
        public async Task<DocDraftDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await DocLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            var nodeId = target.Id;
            var me = currentUser.Id;
            var row = await (
                    from d in db.DocDrafts.AsNoTracking()
                    where d.NodeId == nodeId && d.UserId == me
                    join n in db.DocNodes on d.NodeId equals n.Id
                    select new { d.BaseVersion, n.CurrentVersion, d.Title, d.Content, d.CreatedAt, d.UpdatedAt })
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw AppException.NotFound(DocErrors.DraftNotFound, $"You have no draft of {target.Key}.");
            return new DocDraftDto(target.Key, row.BaseVersion, row.CurrentVersion, row.Title, row.Content, row.CreatedAt, row.UpdatedAt);
        }
    }
}
