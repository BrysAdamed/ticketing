using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Watchers;

public static class DocWatcherQueries
{
    /// <summary>A readable page or diagram; folders have no watchers (409 <c>doc.kind.unsupported</c>).</summary>
    public static async Task<DocTarget> WatchableAsync(ITicketingDbContext db, IProjectAccess access, string docKeyOrId, CancellationToken cancellationToken)
    {
        var doc = await DocLookup.ReadAsync(db, access, docKeyOrId, cancellationToken);
        if (doc.Kind == DocKind.Folder)
            throw AppException.Conflict(DocErrors.KindUnsupported, $"{doc.Key} is a folder; only pages and diagrams can be watched.", "Pass a page or diagram key.");
        return doc;
    }

    /// <summary>The doc's visible watchers; the caller must be able to read <paramref name="doc"/>.</summary>
    public static async Task<WatchersDto> LoadAsync(ITicketingDbContext db, ICurrentUser currentUser, DocTarget doc, CancellationToken cancellationToken)
    {
        var docId = doc.Id;
        var users = await (
                from w in db.DocWatchers.AsNoTracking()
                where w.DocNodeId == docId
                join u in ProjectReaders.Of(db, doc.ProjectId) on w.UserId equals u.Id
                orderby u.DisplayName, u.Id
                select new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive))
            .ToListAsync(cancellationToken);
        var me = currentUser.Id;
        return new WatchersDto(users.Count, users.Exists(u => u.Id == me), users);
    }
}
