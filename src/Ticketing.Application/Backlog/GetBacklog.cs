using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Backlog;

/// <param name="AssigneeId">Users are listed once in <see cref="BacklogDto.Users"/>.</param>
/// <param name="ParentId">Parents are listed once in <see cref="BacklogDto.Parents"/>.</param>
public sealed record BacklogItemDto(
    Guid Id,
    string Key,
    string Title,
    TicketType Type,
    TicketStatus Status,
    Priority Priority,
    Severity? Severity,
    int? StoryPoints,
    string? Version,
    IReadOnlyList<string> Labels,
    Guid? AssigneeId,
    Guid? ParentId,
    DateTimeOffset UpdatedAt,
    int ChildCount,
    int ChildDoneCount,
    int CommentCount,
    int TestCaseCount);

public sealed record BacklogParentDto(Guid Id, string Key, string Title, TicketType Type);

/// <param name="Truncated">True when more than <see cref="GetBacklog.MaxItems"/> tickets matched; narrow the filters.</param>
/// <param name="OnBoardsCount">Tickets of the project that match the same filters but sit on a board (the "N more on boards" footer).</param>
public sealed record BacklogDto(
    Guid ProjectId,
    string ProjectKey,
    bool CanWrite,
    IReadOnlyList<BacklogItemDto> Items,
    IReadOnlyList<UserRefDto> Users,
    IReadOnlyList<BacklogParentDto> Parents,
    bool Truncated,
    int OnBoardsCount);

/// <summary>
/// The project backlog (spec 6.4): tickets with no board, in rank order, Done hidden unless requested. Returned in one
/// lean response (no paging) so the UI can group, virtual-scroll and drag without extra round trips (D-47).
/// </summary>
public static class GetBacklog
{
    public const int MaxItems = 10_000;

    public sealed record Query(
        string ProjectKeyOrId,
        bool ShowDone = false,
        IReadOnlyList<TicketType>? Types = null,
        IReadOnlyList<TicketStatus>? Statuses = null,
        IReadOnlyList<Priority>? Priorities = null,
        string? Assignee = null,
        IReadOnlyList<string>? Labels = null,
        string? Version = null,
        string? Text = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, BacklogDto>
    {
        public async Task<BacklogDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            var projectId = grant.ProjectId;
            var readable = access.ReadableProjects();
            var projectTickets = db.Tickets.AsNoTracking().Where(t => t.ProjectId == projectId && t.DeletedAt == null && readable.Any(p => p.Id == t.ProjectId));
            var tickets = Filter(projectTickets.Where(t => t.BoardId == null), request);
            var onBoardsCount = await Filter(projectTickets.Where(t => t.BoardId != null), request).CountAsync(cancellationToken);

            var rows = await tickets
                .OrderBy(t => t.Rank).ThenBy(t => t.Id)
                .Select(t => new
                {
                    t.Id, t.Number, t.Title, t.Type, t.Status, t.Priority, t.Severity, t.StoryPoints, t.Version, t.Labels,
                    t.AssigneeId, t.ParentId, t.UpdatedAt,
                    ChildCount = db.Tickets.Count(c => c.ParentId == t.Id && c.DeletedAt == null),
                    ChildDoneCount = db.Tickets.Count(c => c.ParentId == t.Id && c.DeletedAt == null && c.Status == TicketStatus.Done),
                    CommentCount = db.Comments.Count(c => c.TicketId == t.Id && c.DeletedAt == null),
                    TestCaseCount = db.TestCases.Count(c => c.TicketId == t.Id && c.ArchivedAt == null),
                })
                .Take(MaxItems + 1)
                .ToListAsync(cancellationToken);

            var truncated = rows.Count > MaxItems;
            if (truncated)
                rows.RemoveAt(rows.Count - 1);

            var key = grant.ProjectKey;
            var items = rows.Select(r => new BacklogItemDto(
                r.Id, HumanKeys.Ticket(key, r.Number), r.Title, r.Type, r.Status, r.Priority, r.Severity, r.StoryPoints, r.Version, r.Labels,
                r.AssigneeId, r.ParentId, r.UpdatedAt, r.ChildCount, r.ChildDoneCount, r.CommentCount, r.TestCaseCount)).ToList();

            var userIds = rows.Where(r => r.AssigneeId is not null).Select(r => r.AssigneeId!.Value).Distinct().ToList();
            var users = await db.Users.AsNoTracking()
                .Where(u => userIds.Contains(u.Id))
                .OrderBy(u => u.DisplayName)
                .Select(u => new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive))
                .ToListAsync(cancellationToken);

            var parentIds = rows.Where(r => r.ParentId is not null).Select(r => r.ParentId!.Value).Distinct().ToList();
            var parents = (await db.Tickets.AsNoTracking()
                    .Where(t => parentIds.Contains(t.Id))
                    .Select(t => new { t.Id, t.Number, t.Title, t.Type })
                    .ToListAsync(cancellationToken))
                .Select(p => new BacklogParentDto(p.Id, HumanKeys.Ticket(key, p.Number), p.Title, p.Type))
                .ToList();

            var canWrite = grant.CanWrite && !grant.IsArchived && currentUser.PatScope != Domain.Tokens.PatScope.ReadOnly;
            return new BacklogDto(projectId, key, canWrite, items, users, parents, truncated, onBoardsCount);
        }

        private IQueryable<Ticket> Filter(IQueryable<Ticket> tickets, Query request)
        {
            if (!request.ShowDone && request.Statuses is not { Count: > 0 })
                tickets = tickets.Where(t => t.Status != TicketStatus.Done);
            if (request.Types is { Count: > 0 } types)
                tickets = tickets.Where(t => types.Contains(t.Type));
            if (request.Statuses is { Count: > 0 } statuses)
                tickets = tickets.Where(t => statuses.Contains(t.Status));
            if (request.Priorities is { Count: > 0 } priorities)
                tickets = tickets.Where(t => priorities.Contains(t.Priority));
            if (request.Labels is { Count: > 0 })
            {
                var labels = TicketLabels.Normalize(request.Labels);
                tickets = tickets.Where(t => labels.All(l => t.Labels.Contains(l)));
            }
            if (!string.IsNullOrWhiteSpace(request.Version))
            {
                var version = request.Version.Trim();
                tickets = tickets.Where(t => t.Version == version);
            }
            tickets = FilterAssignee(tickets, request.Assignee);
            if (!string.IsNullOrWhiteSpace(request.Text))
            {
                var text = request.Text.Trim();
                var pattern = SqlLike.Contains(text);
                int? number = HumanKeys.TryParseTicket(text, out _, out var n) ? n
                    : int.TryParse(text, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var plain) ? plain
                    : null;
                tickets = number is { } exact
                    ? tickets.Where(t => t.Number == exact || EF.Functions.ILike(t.Title, pattern))
                    : tickets.Where(t => EF.Functions.ILike(t.Title, pattern));
            }
            return tickets;
        }

        private IQueryable<Ticket> FilterAssignee(IQueryable<Ticket> tickets, string? assignee)
        {
            if (string.IsNullOrWhiteSpace(assignee))
                return tickets;
            var value = assignee.Trim();
            if (value.Equals("unassigned", StringComparison.OrdinalIgnoreCase))
                return tickets.Where(t => t.AssigneeId == null);
            if (value.Equals(TicketUsers.Me, StringComparison.OrdinalIgnoreCase))
            {
                var me = currentUser.Id;
                return tickets.Where(t => t.AssigneeId == me);
            }
            if (Guid.TryParse(value, out var id))
                return tickets.Where(t => t.AssigneeId == id);
            var email = value.ToLowerInvariant();
            return tickets.Where(t => db.Users.Any(u => u.Id == t.AssigneeId && u.Email == email));
        }
    }
}
