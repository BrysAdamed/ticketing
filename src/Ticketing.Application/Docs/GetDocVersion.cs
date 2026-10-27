using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>One published version of a page or diagram with its full content (the base of a 3-way merge, history views).</summary>
public static class GetDocVersion
{
    public sealed record Query(string KeyOrId, int Number);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, DocVersionDto>
    {
        public async Task<DocVersionDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await DocLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            var nodeId = target.Id;
            var number = request.Number;
            var key = target.Key;
            return await (
                    from v in db.DocVersions.AsNoTracking()
                    where v.NodeId == nodeId && v.Number == number
                    join u in db.Users on v.AuthorId equals u.Id
                    select new DocVersionDto(
                        key, v.Number, v.Title, v.Content, v.ChangeNote, new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive), v.Channel,
                        v.CreatedAt, v.RestoredFrom))
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw AppException.NotFound(
                    DocErrors.VersionNotFound, string.Create(CultureInfo.InvariantCulture, $"{key} has no version {number}."));
        }
    }
}
