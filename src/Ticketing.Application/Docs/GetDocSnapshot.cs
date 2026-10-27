using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// The SVG picture of one Canvas version, for readers of the doc (embeds, history, PDF). <c>doc.version.notFound</c> when the
/// version does not exist, <c>doc.snapshot.notFound</c> while it has no picture yet.
/// </summary>
public static class GetDocSnapshot
{
    public sealed record Query(string KeyOrId, int Number);

    public sealed record Result(string DocKey, int Version, string Svg);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, Result>
    {
        public async Task<Result> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await DocLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            var nodeId = target.Id;
            var number = request.Number;
            var version = await db.DocVersions.AsNoTracking()
                .Where(v => v.NodeId == nodeId && v.Number == number)
                .Select(v => new { v.SnapshotSvg })
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw AppException.NotFound(
                    DocErrors.VersionNotFound, string.Create(CultureInfo.InvariantCulture, $"{target.Key} has no version {number}."));
            if (version.SnapshotSvg is null)
                throw AppException.NotFound(
                    DocErrors.SnapshotNotFound,
                    string.Create(CultureInfo.InvariantCulture, $"Version {number} of {target.Key} has no picture yet; it is rendered when a writer opens the diagram."));
            return new Result(target.Key, number, version.SnapshotSvg);
        }
    }
}
