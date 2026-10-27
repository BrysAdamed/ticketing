using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>The project's most recently updated pages and diagrams (Docs home, spec 1.15).</summary>
public static class GetRecentDocs
{
    public const int DefaultLimit = 10;
    public const int MaxLimit = 50;

    public sealed record Query(string ProjectKeyOrId, int? Limit = null) : IValidatable
    {
        public void Validate(Validator validator) => validator.Range("limit", Limit, 1, MaxLimit);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, IReadOnlyList<DocSummaryDto>>
    {
        public async Task<IReadOnlyList<DocSummaryDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            request.EnsureValid();
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            var projectId = grant.ProjectId;
            var rows = await (
                    from n in db.DocNodes.AsNoTracking()
                    join u in db.Users on n.UpdatedById equals u.Id
                    where n.ProjectId == projectId && n.DeletedAt == null && n.Kind != DocKind.Folder
                    orderby n.UpdatedAt descending, n.Id descending
                    select new { n.Id, n.Number, n.Kind, n.DiagramFormat, n.Title, n.ParentId, n.CurrentVersion, n.UpdatedAt, u.Email, u.DisplayName, u.IsActive, UserId = u.Id })
                .Take(request.Limit ?? DefaultLimit)
                .ToListAsync(cancellationToken);
            var folders = await DocQueries.FoldersAsync(db, projectId, includeDeleted: false, cancellationToken);
            return [.. rows.Select(r =>
            {
                var key = HumanKeys.Doc(grant.ProjectKey, r.Number);
                return new DocSummaryDto(
                    r.Id, key, grant.ProjectKey, r.Kind, r.DiagramFormat, r.Title, folders.PathOf(r.ParentId, r.Title), r.CurrentVersion,
                    new UserRefDto(r.UserId, r.Email, r.DisplayName, r.IsActive), r.UpdatedAt, DocQueries.Url(grant.ProjectKey, key, r.Title));
            })];
        }
    }
}
