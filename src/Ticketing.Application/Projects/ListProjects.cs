using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Projects;

/// <summary>Reference list use case: readable-projects filter, keyset pagination by key, one projection.</summary>
public static class ListProjects
{
    public sealed record Query(string? Search = null, bool IncludeArchived = false, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, CursorPage<ProjectSummaryDto>>
    {
        public async Task<CursorPage<ProjectSummaryDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var page = request.Page ?? new PageRequest();
            var afterKey = Cursor.Decode<string>(page.Cursor);
            var userId = currentUser.Id;

            var query = access.ReadableProjects().AsNoTracking();
            if (!request.IncludeArchived)
                query = query.Where(p => p.ArchivedAt == null);
            if (!string.IsNullOrWhiteSpace(request.Search))
            {
                var pattern = SqlLike.Contains(request.Search.Trim());
                query = query.Where(p => EF.Functions.ILike(p.Name, pattern) || EF.Functions.ILike(p.Key, pattern));
            }
            if (afterKey is not null)
                query = query.Where(p => string.Compare(p.Key, afterKey) > 0);

            var rows = await query
                .OrderBy(p => p.Key)
                .Select(p => new Row(
                    p.Id,
                    p.Key,
                    p.Name,
                    p.Visibility,
                    p.Members.Where(m => m.UserId == userId).Select(m => (ProjectRole?)m.Role).FirstOrDefault(),
                    db.Tickets.Count(t => t.ProjectId == p.Id && t.DeletedAt == null && t.Status != TicketStatus.Done),
                    p.ArchivedAt))
                .ToCursorPageAsync(page, r => r.Key, cancellationToken);

            return rows.Map(r => new ProjectSummaryDto(
                r.Id, r.Key, r.Name, r.Visibility,
                ProjectAccessPolicy.Effective(userIsActive: true, currentUser.Role, r.Visibility, r.Membership) ?? ProjectRole.Viewer,
                r.OpenTicketCount, r.ArchivedAt));
        }

        private sealed record Row(
            Guid Id, string Key, string Name, ProjectVisibility Visibility, ProjectRole? Membership, int OpenTicketCount, DateTimeOffset? ArchivedAt);
    }
}
