using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Projects;

namespace Ticketing.Infrastructure.Persistence;

/// <summary>
/// Allocates numbers with a single upsert on <c>project_counters</c>. The row lock serializes concurrent allocations per
/// project and kind; a rolled-back transaction rolls the counter back too (gaps are tolerated, numbers never reused).
/// </summary>
internal sealed class ProjectCounters(TicketingDbContext db) : IProjectCounters
{
    public async Task<int> NextAsync(Guid projectId, CounterKind kind, CancellationToken cancellationToken)
    {
        var values = await db.Database
            .SqlQuery<int>($"""
                INSERT INTO project_counters (project_id, kind, next_value)
                VALUES ({projectId}, {(int)kind}, 2)
                ON CONFLICT (project_id, kind) DO UPDATE SET next_value = project_counters.next_value + 1
                RETURNING next_value - 1 AS "Value"
                """)
            .ToListAsync(cancellationToken);
        return values.Single();
    }
}
