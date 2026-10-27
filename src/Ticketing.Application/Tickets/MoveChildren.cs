using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Ordering;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <summary>
/// Which sub-tickets come along when parents move with <c>includeChildren</c> (D-107): non-deleted descendants that are still
/// in the place their parent is leaving and not Done. Each descendant belongs to its nearest selected ancestor, so a parent
/// moved together with its own child never moves that child twice. Children are listed in their current rank order.
/// </summary>
public static class MoveChildren
{
    private const int Guard = TicketHierarchy.MaxDepth + 2;

    public sealed record Parent(Guid Id, Guid? BoardId);

    public sealed record Child(Guid Id, Guid ProjectId, int Number);

    public sealed record Group(Guid ParentId, IReadOnlyList<Child> Children, int OnOtherBoard, int InBacklog, int Done);

    private sealed record Row(Guid Id, Guid ParentId, Guid ProjectId, int Number, Guid? BoardId, TicketStatus Status, string Rank);

    /// <summary>One group per parent, in the order of <paramref name="parents"/>.</summary>
    public static async Task<IReadOnlyList<Group>> GroupsAsync(
        ITicketingDbContext db, IReadOnlyList<Parent> parents, CancellationToken cancellationToken)
    {
        var selected = parents.ToDictionary(p => p.Id);
        var rows = new Dictionary<Guid, Row>();
        var frontier = parents.Select(p => p.Id).ToList();
        for (var level = 0; level < Guard && frontier.Count > 0; level++)
        {
            var current = frontier;
            var next = await db.Tickets.AsNoTracking()
                .Where(t => t.ParentId != null && current.Contains(t.ParentId.Value) && t.DeletedAt == null)
                .Select(t => new Row(t.Id, t.ParentId!.Value, t.ProjectId, t.Number, t.BoardId, t.Status, t.Rank))
                .ToListAsync(cancellationToken);
            frontier = [];
            foreach (var row in next.Where(r => !selected.ContainsKey(r.Id) && rows.TryAdd(r.Id, r)))
                frontier.Add(row.Id);
        }

        var byOwner = rows.Values.ToLookup(r => Owner(r, rows, selected));
        return [.. parents.Select(parent =>
        {
            var own = byOwner[parent.Id].ToList();
            var children = own
                .Where(r => r.BoardId == parent.BoardId && r.Status != TicketStatus.Done)
                .OrderBy(r => r.Rank, Ranks.Comparer).ThenBy(r => r.Number)
                .Select(r => new Child(r.Id, r.ProjectId, r.Number))
                .ToList();
            var done = own.Count(r => r.Status == TicketStatus.Done);
            var elsewhere = own.Where(r => r.Status != TicketStatus.Done && r.BoardId != parent.BoardId).ToList();
            return new Group(parent.Id, children, elsewhere.Count(r => r.BoardId is not null), elsewhere.Count(r => r.BoardId is null), done);
        })];
    }

    public static AppException TooMany(int count) =>
        new(ErrorKind.Validation, TicketErrors.MoveTooMany,
            $"With their sub-tickets, {count} tickets would move; at most {MoveTickets.MaxTickets} move at once.",
            "Move fewer tickets at once, or move only the selected tickets without their sub-tickets.",
            new Dictionary<string, string[]> { ["keys"] = [$"{count} tickets including sub-tickets; at most {MoveTickets.MaxTickets}."] });

    private static Guid Owner(Row row, IReadOnlyDictionary<Guid, Row> rows, IReadOnlyDictionary<Guid, Parent> selected)
    {
        var parentId = row.ParentId;
        while (!selected.ContainsKey(parentId))
            parentId = rows[parentId].ParentId;
        return parentId;
    }
}
