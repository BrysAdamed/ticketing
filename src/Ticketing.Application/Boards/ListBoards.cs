using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Boards;

/// <summary>
/// Boards are visible to every signed-in user (D-07), ordered by name. Linked projects and card counts only cover projects
/// the caller can read (spec 5.4), so private projects are neither listed nor counted.
/// </summary>
public static class ListBoards
{
    /// <param name="ProjectKeyOrId">Only boards linking this (readable) project.</param>
    /// <param name="Mine">Only boards the caller owns.</param>
    public sealed record Query(string? Search = null, string? ProjectKeyOrId = null, bool IncludeArchived = false, bool Mine = false, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, CursorPage<BoardSummaryDto>>
    {
        public async Task<CursorPage<BoardSummaryDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var page = request.Page ?? new PageRequest();
            var after = Cursor.Decode<PageKey>(page.Cursor);

            var boards = db.Boards.AsNoTracking().Where(b => b.DeletedAt == null);
            if (!request.IncludeArchived)
                boards = boards.Where(b => b.ArchivedAt == null);
            if (request.Mine)
            {
                var me = currentUser.Id;
                boards = boards.Where(b => b.OwnerId == me);
            }
            if (!string.IsNullOrWhiteSpace(request.ProjectKeyOrId))
            {
                var projectId = (await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken)).ProjectId;
                boards = boards.Where(b => b.Projects.Any(bp => bp.ProjectId == projectId));
            }
            if (!string.IsNullOrWhiteSpace(request.Search))
            {
                var pattern = SqlLike.Contains(request.Search.Trim());
                boards = boards.Where(b => EF.Functions.ILike(b.Name, pattern));
            }
            if (after is not null)
                boards = boards.Where(b => string.Compare(b.Name, after.Name) > 0 || (b.Name == after.Name && b.Id.CompareTo(after.Id) > 0));

            var rows = await (
                    from b in boards
                    join o in db.Users on b.OwnerId equals o.Id
                    orderby b.Name, b.Id
                    select new Row(b.Id, b.Name, b.Description, new UserRefDto(o.Id, o.Email, o.DisplayName, o.IsActive), b.ArchivedAt, b.CreatedAt))
                .ToCursorPageAsync(page, r => new PageKey(r.Name, r.Id), cancellationToken);

            var ids = rows.Items.Select(r => r.Id).ToList();
            var readable = access.ReadableProjects();
            var projects = (await db.BoardProjects.AsNoTracking()
                    .Where(bp => ids.Contains(bp.BoardId))
                    .Join(readable, bp => bp.ProjectId, p => p.Id, (bp, p) => new { bp.BoardId, p.Id, p.Key, p.Name })
                    .OrderBy(x => x.Key)
                    .ToListAsync(cancellationToken))
                .ToLookup(x => x.BoardId, x => new BoardProjectRefDto(x.Id, x.Key, x.Name));

            var counts = (await db.Tickets.AsNoTracking()
                    .Where(t => t.BoardId != null && ids.Contains(t.BoardId!.Value) && t.DeletedAt == null && readable.Any(p => p.Id == t.ProjectId))
                    .GroupBy(t => new { t.BoardId, t.Status })
                    .Select(g => new { g.Key.BoardId, g.Key.Status, Count = g.Count() })
                    .ToListAsync(cancellationToken))
                .ToLookup(x => x.BoardId!.Value);

            var writeScope = currentUser.PatScope != PatScope.ReadOnly;
            return rows.Map(r => new BoardSummaryDto(
                r.Id, r.Name, r.Description, r.Owner, [.. projects[r.Id]],
                Categorize(counts[r.Id].Select(c => (c.Status, c.Count))),
                writeScope && BoardAccess.CanManage(currentUser, r.Owner.Id),
                r.ArchivedAt, r.CreatedAt));
        }

        private static StatusCategoryCountsDto Categorize(IEnumerable<(TicketStatus Status, int Count)> counts)
        {
            int toDo = 0, inProgress = 0, done = 0;
            foreach (var (status, count) in counts)
            {
                switch (status.Category())
                {
                    case StatusCategory.ToDo: toDo += count; break;
                    case StatusCategory.Done: done += count; break;
                    default: inProgress += count; break;
                }
            }
            return new StatusCategoryCountsDto(toDo, inProgress, done);
        }

        private sealed record Row(Guid Id, string Name, string? Description, UserRefDto Owner, DateTimeOffset? ArchivedAt, DateTimeOffset CreatedAt);
    }

    private sealed record PageKey(string Name, Guid Id);
}
