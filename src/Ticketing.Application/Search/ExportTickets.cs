using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Search;

/// <summary>
/// The current search result as rows for CSV export (spec 6.8, I-12): at most 10 000 tickets in the requested order,
/// every scalar field plus labels. Ids are resolved first in one query, then details are streamed in batches.
/// </summary>
public static class ExportTickets
{
    public const int MaxRows = 10_000;
    private const int BatchSize = 500;

    public sealed record Query(TicketSearchCriteria Criteria);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, IAsyncEnumerable<TicketExportRow>>
    {
        public async Task<IAsyncEnumerable<TicketExportRow>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var criteria = request.Criteria;
            var rows = await new TicketSearchQuery(db, access, currentUser).BuildAsync(criteria, cancellationToken);
            var ids = await TicketSearchOrdering.OrderBy(rows, criteria.Sort, criteria.EffectiveOrder)
                .Select(r => r.Id)
                .Take(MaxRows)
                .ToListAsync(cancellationToken);
            return StreamAsync(ids, cancellationToken);
        }

        private async IAsyncEnumerable<TicketExportRow> StreamAsync(List<Guid> ids, [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            foreach (var batch in ids.Chunk(BatchSize))
            {
                var details = await DetailsAsync(batch, cancellationToken);
                foreach (var id in batch)
                {
                    if (details.TryGetValue(id, out var row))
                        yield return row;
                }
            }
        }

        private async Task<Dictionary<Guid, TicketExportRow>> DetailsAsync(Guid[] ids, CancellationToken cancellationToken)
        {
            var rows = await (
                    from t in db.Tickets.AsNoTracking()
                    where ids.Contains(t.Id)
                    join p in db.Projects on t.ProjectId equals p.Id
                    join r in db.Users on t.ReporterId equals r.Id
                    from a in db.Users.Where(u => u.Id == t.AssigneeId).DefaultIfEmpty()
                    from parent in db.Tickets.Where(x => x.Id == t.ParentId).DefaultIfEmpty()
                    from b in db.Boards.Where(x => x.Id == t.BoardId).DefaultIfEmpty()
                    select new
                    {
                        t.Id, ProjectKey = p.Key, ProjectName = p.Name, t.Number, t.Title, t.Type, t.Status, t.Resolution, t.Priority, t.Severity,
                        t.StoryPoints, t.Version, t.Labels, ParentNumber = (int?)parent.Number,
                        AssigneeEmail = a.Email, AssigneeName = a.DisplayName, ReporterEmail = r.Email, ReporterName = r.DisplayName,
                        BoardName = b.Name, t.CreatedAt, t.UpdatedAt, t.StatusChangedAt, t.ResolvedAt, t.Description,
                    })
                .ToListAsync(cancellationToken);

            return rows.ToDictionary(r => r.Id, r => new TicketExportRow(
                HumanKeys.Ticket(r.ProjectKey, r.Number), r.ProjectKey, r.ProjectName, r.Title, r.Type, r.Status, r.Resolution, r.Priority, r.Severity,
                r.StoryPoints, r.Version, r.Labels,
                r.ParentNumber is { } parent ? HumanKeys.Ticket(r.ProjectKey, parent) : null,
                r.AssigneeEmail, r.AssigneeName, r.ReporterEmail, r.ReporterName, r.BoardName is null ? "Backlog" : $"Board: {r.BoardName}",
                r.CreatedAt, r.UpdatedAt, r.StatusChangedAt, r.ResolvedAt, r.Description));
        }
    }
}

public sealed record TicketExportRow(
    string Key,
    string ProjectKey,
    string ProjectName,
    string Title,
    TicketType Type,
    TicketStatus Status,
    Resolution? Resolution,
    Priority Priority,
    Severity? Severity,
    int? StoryPoints,
    string? Version,
    IReadOnlyList<string> Labels,
    string? ParentKey,
    string? AssigneeEmail,
    string? AssigneeName,
    string ReporterEmail,
    string ReporterName,
    string Location,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset StatusChangedAt,
    DateTimeOffset? ResolvedAt,
    string? Description);
