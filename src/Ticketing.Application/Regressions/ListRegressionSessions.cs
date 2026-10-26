using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Regressions;

namespace Ticketing.Application.Regressions;

/// <summary>The project's regression sessions, newest first, each with its summary (one aggregate query per page).</summary>
public static class ListRegressionSessions
{
    public sealed record Query(string ProjectKeyOrId, IReadOnlyList<RegressionSessionStatus>? Statuses = null, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, CursorPage<RegressionSessionSummaryDto>>
    {
        public async Task<CursorPage<RegressionSessionSummaryDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            var page = request.Page ?? new PageRequest();
            var beforeNumber = Cursor.Decode<int?>(page.Cursor);
            var projectId = grant.ProjectId;

            var sessions = db.RegressionSessions.AsNoTracking().Where(s => s.ProjectId == projectId);
            if (request.Statuses is { Count: > 0 } statuses)
                sessions = sessions.Where(s => statuses.Contains(s.Status));
            if (beforeNumber is { } before)
                sessions = sessions.Where(s => s.Number < before);

            var rows = await RegressionQueries.SessionRows(db, sessions.OrderByDescending(s => s.Number))
                .ToCursorPageAsync(page, r => (int?)r.Number, cancellationToken);
            var summaries = await RegressionQueries.SummariesAsync(db, [.. rows.Items.Select(r => r.Id)], cancellationToken);
            return rows.Map(r => r.ToDto(grant.ProjectKey, summaries[r.Id]));
        }
    }
}
