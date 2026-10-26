using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <summary>Shared read projections for tickets (one query each, no N+1).</summary>
public static class TicketQueries
{
    public static string Url(string key) => $"/tickets/{key}";

    /// <summary>Ticket summaries (spec 9.2) for <paramref name="ids"/>, returned in the order of <paramref name="ids"/>.</summary>
    public static async Task<IReadOnlyList<TicketSummaryDto>> SummariesAsync(
        ITicketingDbContext db, IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken)
    {
        var rows = await (
                from t in db.Tickets.AsNoTracking()
                where ids.Contains(t.Id)
                join p in db.Projects on t.ProjectId equals p.Id
                from a in db.Users.Where(u => u.Id == t.AssigneeId).DefaultIfEmpty()
                from parent in db.Tickets.Where(x => x.Id == t.ParentId).DefaultIfEmpty()
                from b in db.Boards.Where(x => x.Id == t.BoardId).DefaultIfEmpty()
                select new
                {
                    t.Id,
                    ProjectKey = p.Key,
                    t.Number,
                    t.Title,
                    t.Type,
                    t.Status,
                    t.Priority,
                    t.Severity,
                    AssigneeId = (Guid?)a.Id,
                    AssigneeEmail = a.Email,
                    AssigneeName = a.DisplayName,
                    AssigneeActive = (bool?)a.IsActive,
                    t.StoryPoints,
                    t.Labels,
                    t.Version,
                    ParentNumber = (int?)parent.Number,
                    t.BoardId,
                    BoardName = b.Name,
                    t.UpdatedAt,
                    t.RowVersion,
                })
            .ToListAsync(cancellationToken);

        var byId = rows.ToDictionary(r => r.Id, r =>
        {
            var key = HumanKeys.Ticket(r.ProjectKey, r.Number);
            return new TicketSummaryDto(
                r.Id, key, r.ProjectKey, r.Title, r.Type, r.Status, r.Priority, r.Severity,
                User(r.AssigneeId, r.AssigneeEmail, r.AssigneeName, r.AssigneeActive),
                r.StoryPoints, r.Labels, r.Version,
                r.ParentNumber is { } parent ? HumanKeys.Ticket(r.ProjectKey, parent) : null,
                Location(r.BoardId, r.BoardName), r.UpdatedAt, Url(key), r.RowVersion);
        });
        return [.. ids.Where(byId.ContainsKey).Select(id => byId[id])];
    }

    public static UserRefDto? User(Guid? id, string? email, string? name, bool? isActive) =>
        id is { } userId ? new UserRefDto(userId, email!, name!, isActive ?? false) : null;

    public static TicketLocationDto Location(Guid? boardId, string? boardName) =>
        boardId is null ? new TicketLocationDto(TicketLocationKind.Backlog, null, null) : new TicketLocationDto(TicketLocationKind.Board, boardId, boardName);

    public static string LinkLabel(TicketLinkType type, LinkDirection direction) => (type, direction) switch
    {
        (TicketLinkType.Blocks, LinkDirection.Outward) => "blocks",
        (TicketLinkType.Blocks, LinkDirection.Inward) => "is blocked by",
        (TicketLinkType.Duplicates, LinkDirection.Outward) => "duplicates",
        (TicketLinkType.Duplicates, LinkDirection.Inward) => "is duplicated by",
        _ => "relates to",
    };

    public static ProgressDto Progress(IEnumerable<TicketStatus> statuses)
    {
        int toDo = 0, inProgress = 0, done = 0;
        foreach (var status in statuses)
        {
            switch (status.Category())
            {
                case StatusCategory.ToDo: toDo++; break;
                case StatusCategory.Done: done++; break;
                default: inProgress++; break;
            }
        }
        return new ProgressDto(toDo, inProgress, done, toDo + inProgress + done);
    }
}
