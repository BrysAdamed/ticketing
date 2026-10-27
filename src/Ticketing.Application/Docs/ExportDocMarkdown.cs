using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>The latest markdown of a page as a download (docs refinement 1.11): readers, Viewers and archived projects included.</summary>
public static class ExportDocMarkdown
{
    public sealed record Query(string KeyOrId);

    /// <param name="FileName">The page title made safe for a file name (the key when nothing is left), ending in <c>.md</c>.</param>
    public sealed record Result(string FileName, string Content);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, Result>
    {
        public async Task<Result> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await DocLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            if (target.Kind != DocKind.Page)
                throw AppException.Conflict(
                    DocErrors.KindUnsupported, $"{target.Key} is a {target.Kind.ToString().ToLowerInvariant()}; only pages export as markdown.", "Pass a page key.");
            var id = target.Id;
            var page = await db.DocNodes.AsNoTracking().Where(n => n.Id == id).Select(n => new { n.Title, n.Content }).SingleAsync(cancellationToken);
            return new Result(DocTitles.FileName(page.Title, target.Key, ".md"), page.Content ?? string.Empty);
        }
    }
}
