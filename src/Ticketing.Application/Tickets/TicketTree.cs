using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <summary>Reads the parent/child structure that <see cref="TicketHierarchy"/> needs (at most a few levels, spec 6.3).</summary>
public static class TicketTree
{
    private const int Guard = TicketHierarchy.MaxDepth + 2;

    /// <summary>The ancestors of <paramref name="ticketId"/>, nearest first.</summary>
    public static async Task<IReadOnlyList<Guid>> AncestorsAsync(ITicketingDbContext db, Guid ticketId, CancellationToken cancellationToken)
    {
        var ancestors = new List<Guid>();
        Guid? current = ticketId;
        while (ancestors.Count < Guard)
        {
            var id = current.Value;
            current = await db.Tickets.Where(t => t.Id == id).Select(t => t.ParentId).SingleOrDefaultAsync(cancellationToken);
            if (current is null || ancestors.Contains(current.Value) || current.Value == ticketId)
                break;
            ancestors.Add(current.Value);
        }
        return ancestors;
    }

    /// <summary>Levels in the subtree of <paramref name="ticketId"/> including the ticket itself (1 for a leaf); non-deleted children only.</summary>
    public static async Task<int> SubtreeHeightAsync(ITicketingDbContext db, Guid ticketId, CancellationToken cancellationToken)
    {
        var height = 1;
        List<Guid> frontier = [ticketId];
        while (height < Guard)
        {
            var level = frontier;
            frontier = await db.Tickets
                .Where(t => t.ParentId != null && level.Contains(t.ParentId.Value) && t.DeletedAt == null)
                .Select(t => t.Id)
                .ToListAsync(cancellationToken);
            if (frontier.Count == 0)
                break;
            height++;
        }
        return height;
    }

    public static async Task SetParentAsync(ITicketingDbContext db, Ticket child, Guid parentId, CancellationToken cancellationToken)
    {
        var parent = await db.Tickets.AsNoTracking().SingleAsync(t => t.Id == parentId, cancellationToken);
        var ancestors = await AncestorsAsync(db, parentId, cancellationToken);
        var height = await SubtreeHeightAsync(db, child.Id, cancellationToken);
        child.SetParent(parent, ancestors, height);
    }
}
