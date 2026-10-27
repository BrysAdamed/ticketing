using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <param name="External">True for a linked ticket that is not a child of the requested ticket.</param>
/// <param name="Blocked">Open, with at least one open readable ticket that blocks it.</param>
public sealed record TicketGraphNodeDto(
    Guid Id, string Key, string Title, TicketType Type, TicketStatus Status, Priority Priority, UserRefDto? Assignee, bool External, bool Blocked);

/// <param name="From">Blocks: the blocking ticket. Duplicates: the duplicate. RelatesTo: either end (unordered).</param>
public sealed record TicketGraphEdgeDto(Guid LinkId, TicketLinkType Type, string From, string To);

public sealed record TicketGraphDto(string Key, IReadOnlyList<TicketGraphNodeDto> Nodes, IReadOnlyList<TicketGraphEdgeDto> Edges);

/// <summary>
/// The children of a ticket and the links that touch them (D-94): links among the children, and links to tickets outside the
/// parent, which become external nodes. Tickets in projects the caller cannot read and deleted tickets are left out.
/// </summary>
public static class GetChildrenGraph
{
    public sealed record Query(string KeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, TicketGraphDto>
    {
        public async Task<TicketGraphDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            var parentId = target.Id;

            var children = await NodesAsync(
                db.Tickets.AsNoTracking().Where(t => t.ParentId == parentId && t.DeletedAt == null), cancellationToken);
            var childIds = children.Select(c => c.Id).ToList();

            var links = await db.TicketLinks.AsNoTracking()
                .Where(l => childIds.Contains(l.SourceTicketId) || childIds.Contains(l.TargetTicketId))
                .OrderBy(l => l.CreatedAt)
                .Select(l => new { l.Id, l.Type, l.SourceTicketId, l.TargetTicketId })
                .ToListAsync(cancellationToken);

            var childSet = childIds.ToHashSet();
            var externalIds = links
                .SelectMany(l => new[] { l.SourceTicketId, l.TargetTicketId })
                .Where(id => !childSet.Contains(id))
                .Distinct()
                .ToList();
            var readable = access.ReadableProjects();
            var externals = externalIds.Count == 0
                ? []
                : await NodesAsync(
                    db.Tickets.AsNoTracking().Where(t =>
                        externalIds.Contains(t.Id) && t.DeletedAt == null && readable.Any(p => p.Id == t.ProjectId)),
                    cancellationToken);

            var nodes = children.Concat(externals.OrderBy(e => e.ProjectKey).ThenBy(e => e.Number)).ToDictionary(n => n.Id);
            var edges = links
                .Where(l => nodes.ContainsKey(l.SourceTicketId) && nodes.ContainsKey(l.TargetTicketId))
                .Select(l => new TicketGraphEdgeDto(l.Id, l.Type, nodes[l.SourceTicketId].Key, nodes[l.TargetTicketId].Key))
                .ToList();

            var open = nodes.Values.Where(n => n.Status.IsOpen()).Select(n => n.Key).ToHashSet();
            var blocked = edges
                .Where(e => e.Type == TicketLinkType.Blocks && open.Contains(e.From) && open.Contains(e.To))
                .Select(e => e.To)
                .ToHashSet();

            return new TicketGraphDto(
                HumanKeys.Ticket(target.Grant.ProjectKey, target.Number),
                [.. nodes.Values.Select(n => new TicketGraphNodeDto(
                    n.Id, n.Key, n.Title, n.Type, n.Status, n.Priority, n.Assignee, !childSet.Contains(n.Id), blocked.Contains(n.Key)))],
                edges);
        }

        private async Task<List<NodeRow>> NodesAsync(IQueryable<Ticket> tickets, CancellationToken cancellationToken)
        {
            var rows = await (
                    from t in tickets
                    join p in db.Projects on t.ProjectId equals p.Id
                    from a in db.Users.Where(u => u.Id == t.AssigneeId).DefaultIfEmpty()
                    orderby t.Number
                    select new
                    {
                        t.Id, ProjectKey = p.Key, t.Number, t.Title, t.Type, t.Status, t.Priority,
                        AssigneeId = (Guid?)a.Id, AssigneeEmail = a.Email, AssigneeName = a.DisplayName, AssigneeActive = (bool?)a.IsActive,
                    })
                .ToListAsync(cancellationToken);
            return [.. rows.Select(r => new NodeRow(
                r.Id, r.ProjectKey, r.Number, HumanKeys.Ticket(r.ProjectKey, r.Number), r.Title, r.Type, r.Status, r.Priority,
                TicketQueries.User(r.AssigneeId, r.AssigneeEmail, r.AssigneeName, r.AssigneeActive)))];
        }

        private sealed record NodeRow(
            Guid Id, string ProjectKey, int Number, string Key, string Title, TicketType Type, TicketStatus Status, Priority Priority, UserRefDto? Assignee);
    }
}
