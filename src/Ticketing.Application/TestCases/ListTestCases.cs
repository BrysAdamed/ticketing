using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.TestCases;

namespace Ticketing.Application.TestCases;

/// <summary>
/// The project's test cases ordered by number (spec 6.10): filters by status, linked ticket, text (title or key) and
/// archived, plus counts by status for the same ticket and text filters so the UI can show them as filter chips.
/// </summary>
public static class ListTestCases
{
    public sealed record Query(
        string ProjectKeyOrId,
        IReadOnlyList<TestCaseStatus>? Statuses = null,
        string? TicketKey = null,
        string? Text = null,
        bool IncludeArchived = false,
        PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, TestCaseListDto>
    {
        public async Task<TestCaseListDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            var page = request.Page ?? new PageRequest();
            var afterNumber = Cursor.Decode<int?>(page.Cursor);

            var filtered = await FilterAsync(grant, request, cancellationToken);
            var counts = await CountsAsync(filtered, cancellationToken);

            if (!request.IncludeArchived)
                filtered = filtered.Where(c => c.ArchivedAt == null);
            if (request.Statuses is { Count: > 0 } statuses)
                filtered = filtered.Where(c => statuses.Contains(c.Status));
            if (afterNumber is { } after)
                filtered = filtered.Where(c => c.Number > after);

            var rows = await TestCaseQueries.Summaries(db, filtered.OrderBy(c => c.Number))
                .ToCursorPageAsync(page, r => (int?)r.Number, cancellationToken);
            return new TestCaseListDto([.. rows.Items.Select(r => r.ToDto(grant.ProjectKey))], rows.NextCursor, counts);
        }

        private async Task<IQueryable<TestCase>> FilterAsync(ProjectAccessGrant grant, Query request, CancellationToken cancellationToken)
        {
            var projectId = grant.ProjectId;
            var query = db.TestCases.AsNoTracking().Where(c => c.ProjectId == projectId);

            if (!string.IsNullOrWhiteSpace(request.TicketKey))
            {
                var ticketId = await TestCaseQueries.LinkedTicketAsync(db, grant, request.TicketKey, cancellationToken);
                query = query.Where(c => c.TicketId == ticketId);
            }

            var text = request.Text?.Trim();
            if (string.IsNullOrEmpty(text))
                return query;
            if (HumanKeys.TryParseTestCase(text, out var projectKey, out var number))
                return projectKey == grant.ProjectKey ? query.Where(c => c.Number == number) : query.Where(_ => false);
            var pattern = SqlLike.Contains(text);
            if (int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var plainNumber))
                return query.Where(c => c.Number == plainNumber || EF.Functions.ILike(c.Title, pattern));
            return query.Where(c => EF.Functions.ILike(c.Title, pattern));
        }

        private static async Task<TestCaseCountsDto> CountsAsync(IQueryable<TestCase> query, CancellationToken cancellationToken)
        {
            var groups = await query
                .GroupBy(c => new { c.Status, Archived = c.ArchivedAt != null })
                .Select(g => new { g.Key.Status, g.Key.Archived, Count = g.Count() })
                .ToListAsync(cancellationToken);

            int Active(TestCaseStatus status) => groups.Where(g => !g.Archived && g.Status == status).Sum(g => g.Count);
            return new TestCaseCountsDto(
                Active(TestCaseStatus.New), Active(TestCaseStatus.Manual), Active(TestCaseStatus.Automatic), groups.Where(g => g.Archived).Sum(g => g.Count));
        }
    }
}
