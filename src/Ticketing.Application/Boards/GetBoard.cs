using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Boards;

/// <summary>
/// A board with its columns (spec 6.4): every status in enum order, cards in board rank order. Cards from projects the
/// caller cannot read are omitted entirely (spec 6.5). One query loads all cards with their parent and grandparent, so a
/// 500-card board is a single indexed range scan.
/// </summary>
public static class GetBoard
{
    private static readonly TicketStatus[] AllStatuses = Enum.GetValues<TicketStatus>();

    /// <param name="Statuses">Only these columns; all 8 when empty.</param>
    /// <param name="Assignee">A user id, email, <c>me</c> or <c>unassigned</c>.</param>
    public sealed record Query(string BoardId, IReadOnlyList<TicketStatus>? Statuses = null, string? Assignee = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, BoardDto>
    {
        public Task<BoardDto> HandleAsync(Query request, CancellationToken cancellationToken) =>
            LoadAsync(db, access, currentUser, BoardAccess.ParseId(request.BoardId), cancellationToken, request.Statuses, request.Assignee);

        internal static async Task<BoardDto> LoadAsync(
            ITicketingDbContext db,
            IProjectAccess access,
            ICurrentUser currentUser,
            Guid boardId,
            CancellationToken cancellationToken,
            IReadOnlyList<TicketStatus>? statuses = null,
            string? assignee = null)
        {
            var board = await (
                    from b in db.Boards.AsNoTracking()
                    where b.Id == boardId && b.DeletedAt == null
                    join o in db.Users on b.OwnerId equals o.Id
                    select new { b.Id, b.Name, b.Description, b.ArchivedAt, b.CreatedAt, b.RowVersion, Owner = new UserRefDto(o.Id, o.Email, o.DisplayName, o.IsActive) })
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw BoardAccess.NotFound(boardId.ToString());

            var readable = access.ReadableProjects();
            var userId = currentUser.Id;
            var projectRows = await db.BoardProjects.AsNoTracking()
                .Where(bp => bp.BoardId == boardId)
                .Join(readable, bp => bp.ProjectId, p => p.Id, (bp, p) => p)
                .OrderBy(p => p.Key)
                .Select(p => new
                {
                    p.Id,
                    p.Key,
                    p.Name,
                    p.Visibility,
                    p.ArchivedAt,
                    Membership = p.Members.Where(m => m.UserId == userId).Select(m => (ProjectRole?)m.Role).FirstOrDefault(),
                })
                .ToListAsync(cancellationToken);

            var cardCounts = await db.Tickets.AsNoTracking()
                .Where(t => t.BoardId == boardId && t.DeletedAt == null && readable.Any(p => p.Id == t.ProjectId))
                .GroupBy(t => t.ProjectId)
                .Select(g => new { ProjectId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(g => g.ProjectId, g => g.Count, cancellationToken);

            var writeScope = currentUser.PatScope != PatScope.ReadOnly;
            var projects = projectRows.Select(p => new BoardProjectDto(
                    p.Id, p.Key, p.Name,
                    writeScope && p.ArchivedAt is null && ProjectAccessPolicy.CanWrite(ProjectAccessPolicy.Effective(true, currentUser.Role, p.Visibility, p.Membership)),
                    p.ArchivedAt is not null,
                    cardCounts.GetValueOrDefault(p.Id)))
                .ToList();

            var cards = await CardsAsync(db, readable, currentUser, boardId, statuses, assignee, cancellationToken);
            var wanted = statuses is { Count: > 0 } ? AllStatuses.Where(statuses.Contains) : AllStatuses;
            var byStatus = cards.ToLookup(c => c.Status);
            var columns = wanted
                .Select(status => new BoardColumnDto(status, status.Category(), [.. byStatus[status].Select(c => c.Card)]))
                .ToList();

            var parents = cards
                .SelectMany(c => new[] { c.Parent, c.GrandParent })
                .OfType<BoardParentDto>()
                .DistinctBy(p => p.Id)
                .ToList();

            var userIds = cards.Where(c => c.Card.AssigneeId is not null).Select(c => c.Card.AssigneeId!.Value).Distinct().ToList();
            var users = await db.Users.AsNoTracking()
                .Where(u => userIds.Contains(u.Id))
                .OrderBy(u => u.DisplayName)
                .Select(u => new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive))
                .ToListAsync(cancellationToken);

            var canManage = writeScope && BoardAccess.CanManage(currentUser, board.Owner.Id);
            return new BoardDto(
                board.Id, board.Name, board.Description, board.Owner, board.ArchivedAt, board.CreatedAt,
                new BoardPermissionsDto(canManage), projects, columns, users, parents, board.RowVersion);
        }

        private static async Task<List<CardRow>> CardsAsync(
            ITicketingDbContext db,
            IQueryable<Project> readable,
            ICurrentUser currentUser,
            Guid boardId,
            IReadOnlyList<TicketStatus>? statuses,
            string? assignee,
            CancellationToken cancellationToken)
        {
            var tickets = db.Tickets.AsNoTracking().Where(t => t.BoardId == boardId && t.DeletedAt == null);
            if (statuses is { Count: > 0 })
                tickets = tickets.Where(t => statuses.Contains(t.Status));
            tickets = FilterAssignee(db, currentUser, tickets, assignee);

            var rows = await (
                    from t in tickets
                    join p in readable on t.ProjectId equals p.Id
                    from parent in db.Tickets.Where(x => x.Id == t.ParentId).DefaultIfEmpty()
                    from grand in db.Tickets.Where(x => x.Id == parent.ParentId).DefaultIfEmpty()
                    orderby t.Rank, t.Id
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
                        t.StoryPoints,
                        t.Labels,
                        t.AssigneeId,
                        t.ParentId,
                        ParentNumber = (int?)parent.Number,
                        ParentTitle = parent.Title,
                        ParentType = (TicketType?)parent.Type,
                        GrandId = (Guid?)grand.Id,
                        GrandNumber = (int?)grand.Number,
                        GrandTitle = grand.Title,
                        GrandType = (TicketType?)grand.Type,
                    })
                .ToListAsync(cancellationToken);

            return rows.Select(r => new CardRow(
                    r.Status,
                    new BoardCardDto(
                        r.Id, HumanKeys.Ticket(r.ProjectKey, r.Number), r.ProjectKey, r.Title, r.Type, r.Priority, r.Severity, r.StoryPoints,
                        r.Labels, r.AssigneeId, r.ParentId),
                    r.ParentId is { } parentId
                        ? new BoardParentDto(parentId, HumanKeys.Ticket(r.ProjectKey, r.ParentNumber!.Value), r.ParentTitle!, r.ParentType!.Value, r.GrandId)
                        : null,
                    r.GrandId is { } grandId
                        ? new BoardParentDto(grandId, HumanKeys.Ticket(r.ProjectKey, r.GrandNumber!.Value), r.GrandTitle!, r.GrandType!.Value, null)
                        : null))
                .ToList();
        }

        private static IQueryable<Ticket> FilterAssignee(ITicketingDbContext db, ICurrentUser currentUser, IQueryable<Ticket> tickets, string? assignee)
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

    private sealed record CardRow(TicketStatus Status, BoardCardDto Card, BoardParentDto? Parent, BoardParentDto? GrandParent);
}
