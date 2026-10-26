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
    public const int DescriptionPreviewLength = 160;

    /// <param name="Search">Case-insensitive substring of the key or name.</param>
    /// <param name="Visibility">Only projects with this visibility.</param>
    /// <param name="MineOnly">Only projects where the caller has an explicit membership.</param>
    public sealed record Query(
        string? Search = null,
        bool IncludeArchived = false,
        PageRequest? Page = null,
        ProjectVisibility? Visibility = null,
        bool MineOnly = false);

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
            if (request.Visibility is { } visibility)
                query = query.Where(p => p.Visibility == visibility);
            if (request.MineOnly)
                query = query.Where(p => p.Members.Any(m => m.UserId == userId));
            if (!string.IsNullOrWhiteSpace(request.Search))
            {
                var pattern = SqlLike.Contains(request.Search.Trim());
                query = query.Where(p => EF.Functions.ILike(p.Name, pattern) || EF.Functions.ILike(p.Key, pattern));
            }
            if (afterKey is not null)
                query = query.Where(p => string.Compare(p.Key, afterKey) > 0);

            var tickets = db.Tickets.Where(t => t.DeletedAt == null);
            var rows = await query
                .OrderBy(p => p.Key)
                .Select(p => new Row(
                    p.Id,
                    p.Key,
                    p.Name,
                    p.Description == null ? null : p.Description.Substring(0, DescriptionPreviewLength),
                    p.Visibility,
                    p.Members.Where(m => m.UserId == userId).Select(m => (ProjectRole?)m.Role).FirstOrDefault(),
                    tickets.Count(t => t.ProjectId == p.Id && t.Status == TicketStatus.ToDo),
                    tickets.Count(t => t.ProjectId == p.Id && t.Status != TicketStatus.ToDo && t.Status != TicketStatus.Done),
                    tickets.Count(t => t.ProjectId == p.Id && t.Status == TicketStatus.Done),
                    db.ProjectMembers
                        .Where(m => m.ProjectId == p.Id && m.Role == ProjectRole.Owner)
                        .Join(db.Users.Where(u => u.IsActive), m => m.UserId, u => u.Id, (m, u) => new { m.AddedAt, u.Id, u.DisplayName })
                        .OrderBy(x => x.AddedAt).ThenBy(x => x.Id)
                        .Select(x => new ProjectLeadDto(x.Id, x.DisplayName))
                        .FirstOrDefault(),
                    tickets.Where(t => t.ProjectId == p.Id).Max(t => (DateTimeOffset?)t.UpdatedAt) ?? p.CreatedAt,
                    p.ArchivedAt))
                .ToCursorPageAsync(page, r => r.Key, cancellationToken);

            return rows.Map(r => new ProjectSummaryDto(
                r.Id, r.Key, r.Name, r.DescriptionPreview, r.Visibility,
                ProjectAccessPolicy.Effective(userIsActive: true, currentUser.Role, r.Visibility, r.Membership) ?? ProjectRole.Viewer,
                r.Membership is not null,
                r.ToDo + r.InProgress,
                new TicketCategoryCountsDto(r.ToDo, r.InProgress, r.Done),
                r.Lead,
                r.UpdatedAt,
                r.ArchivedAt));
        }

        private sealed record Row(
            Guid Id,
            string Key,
            string Name,
            string? DescriptionPreview,
            ProjectVisibility Visibility,
            ProjectRole? Membership,
            int ToDo,
            int InProgress,
            int Done,
            ProjectLeadDto? Lead,
            DateTimeOffset UpdatedAt,
            DateTimeOffset? ArchivedAt);
    }
}
