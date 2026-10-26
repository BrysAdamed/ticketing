using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;

namespace Ticketing.Application.Dashboard;

/// <summary>
/// Versions offered by the dashboard's version filter: distinct versions of the project's non-deleted tickets and of its
/// regression sessions, by case-insensitive prefix, most recently used first, at most 20 (the version-hint rule of spec 6.7).
/// </summary>
public static class ListDashboardVersions
{
    public const int MaxVersions = 20;

    public sealed record Query(string ProjectKeyOrId, string? Prefix = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, IReadOnlyList<string>>
    {
        public async Task<IReadOnlyList<string>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            var pattern = SqlLike.StartsWith(request.Prefix?.Trim() ?? string.Empty);
            return await db.Database.SqlQuery<string>($"""
                SELECT v.version AS "Value"
                FROM (
                    SELECT version, updated_at AS used_at FROM tickets
                    WHERE project_id = {grant.ProjectId} AND deleted_at IS NULL AND version IS NOT NULL
                    UNION ALL
                    SELECT version, started_at FROM regression_sessions
                    WHERE project_id = {grant.ProjectId} AND version IS NOT NULL
                ) AS v
                WHERE v.version ILIKE {pattern}
                GROUP BY v.version
                ORDER BY max(v.used_at) DESC, v.version
                LIMIT {MaxVersions}
                """).ToListAsync(cancellationToken);
        }
    }
}
