using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Docs;

/// <summary>
/// The project's deleted docs, one entry per delete group (its root), newest first (spec 1.5: Owners only). Nothing is
/// purged in v1; restore with <see cref="RestoreDoc"/>.
/// </summary>
public static class ListDocTrash
{
    public sealed record Query(string ProjectKeyOrId, PageRequest Page);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, CursorPage<DocTrashItemDto>>
    {
        public async Task<CursorPage<DocTrashItemDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            if (!grant.IsOwner)
                throw AppException.Forbidden(ProjectErrors.Forbidden, $"Only owners of project {grant.ProjectKey} can see its docs trash.");

            var projectId = grant.ProjectId;
            var after = Cursor.Decode<TrashCursor>(request.Page.Cursor);
            var roots = db.DocNodes.AsNoTracking().Where(n => n.ProjectId == projectId && n.DeletedAt != null && n.DeletedRootId == n.Id);
            if (after is not null)
                roots = roots.Where(n => n.DeletedAt < after.DeletedAt || (n.DeletedAt == after.DeletedAt && n.Id.CompareTo(after.Id) < 0));
            var page = await (
                    from n in roots
                    join u in db.Users on n.DeletedById equals u.Id
                    orderby n.DeletedAt descending, n.Id descending
                    select new Row(
                        n.Id, n.Number, n.Kind, n.DiagramFormat, n.Title, n.ParentId, n.DeletedAt!.Value,
                        db.DocNodes.Count(x => x.DeletedRootId == n.Id),
                        new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive)))
                .ToCursorPageAsync(request.Page, r => new TrashCursor(r.DeletedAt, r.Id), cancellationToken);

            var folders = await DocQueries.FoldersAsync(db, projectId, includeDeleted: true, cancellationToken);
            return page.Map(r => new DocTrashItemDto(
                r.Id, HumanKeys.Doc(grant.ProjectKey, r.Number), r.Kind, r.DiagramFormat, r.Title, folders.PathOf(r.ParentId, r.Title), r.Count, r.DeletedBy,
                r.DeletedAt));
        }

        private sealed record Row(
            Guid Id, int Number, DocKind Kind, DiagramFormat? DiagramFormat, string Title, Guid? ParentId, DateTimeOffset DeletedAt,
            int Count, UserRefDto DeletedBy);

        private sealed record TrashCursor(DateTimeOffset DeletedAt, Guid Id);
    }
}
