using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;

namespace Ticketing.Application.Tickets;

public enum HintField
{
    Labels = 1,
    Version = 2,
}

/// <summary>
/// Field hints (spec 6.7): distinct values used in the project's non-deleted tickets (versions also from regression
/// sessions), filtered by case-insensitive prefix, most recently used first, at most 20.
/// </summary>
public static class GetFieldHints
{
    public const int MaxHints = 20;

    public sealed record Query(string ProjectKeyOrId, HintField Field, string? Prefix = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, IReadOnlyList<string>>
    {
        public async Task<IReadOnlyList<string>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            var projectId = grant.ProjectId;
            var pattern = SqlLike.StartsWith(request.Prefix?.Trim() ?? string.Empty);
            var query = request.Field switch
            {
                HintField.Labels => db.Database.SqlQuery<string>($"""
                    SELECT l.label AS "Value"
                    FROM tickets t CROSS JOIN LATERAL unnest(t.labels) AS l(label)
                    WHERE t.project_id = {projectId} AND t.deleted_at IS NULL AND l.label ILIKE {pattern}
                    GROUP BY l.label
                    ORDER BY max(t.updated_at) DESC, l.label
                    LIMIT {MaxHints}
                    """),
                HintField.Version => db.Database.SqlQuery<string>($"""
                    SELECT v.version AS "Value"
                    FROM (
                        SELECT version, updated_at AS used_at FROM tickets
                        WHERE project_id = {projectId} AND deleted_at IS NULL AND version IS NOT NULL
                        UNION ALL
                        SELECT version, started_at FROM regression_sessions
                        WHERE project_id = {projectId} AND version IS NOT NULL
                    ) AS v
                    WHERE v.version ILIKE {pattern}
                    GROUP BY v.version
                    ORDER BY max(v.used_at) DESC, v.version
                    LIMIT {MaxHints}
                    """),
                _ => throw AppException.Invalid("field", "field must be labels or version."),
            };
            return await query.ToListAsync(cancellationToken);
        }
    }
}
