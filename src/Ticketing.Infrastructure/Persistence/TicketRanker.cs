using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Ordering;
using Ticketing.Domain.Tickets;

namespace Ticketing.Infrastructure.Persistence;

internal sealed class TicketRanker(TicketingDbContext db) : ITicketRanker
{
    public async Task<string> BottomAsync(RankContainer container, CancellationToken cancellationToken)
    {
        var last = await InContainer(container).OrderByDescending(t => t.Rank).Select(t => t.Rank).FirstOrDefaultAsync(cancellationToken);
        var rank = Ranks.Between(last, null);
        return Ranks.NeedsRebalance(rank) ? await RebalanceAsync(container, last, null, cancellationToken) : rank;
    }

    public async Task<string> TopAsync(RankContainer container, CancellationToken cancellationToken)
    {
        var first = await InContainer(container).OrderBy(t => t.Rank).Select(t => t.Rank).FirstOrDefaultAsync(cancellationToken);
        var rank = Ranks.Between(null, first);
        return Ranks.NeedsRebalance(rank) ? await RebalanceAsync(container, null, null, cancellationToken) : rank;
    }

    public async Task<string> BetweenAsync(RankContainer container, string? before, string? after, Guid? movingTicketId, CancellationToken cancellationToken)
    {
        var rank = Ranks.Between(before, after);
        return Ranks.NeedsRebalance(rank) ? await RebalanceAsync(container, before, movingTicketId, cancellationToken) : rank;
    }

    /// <summary>Rewrites the whole container with short, evenly spaced ranks and returns the rank for the slot after <paramref name="before"/>.</summary>
    private async Task<string> RebalanceAsync(RankContainer container, string? before, Guid? movingTicketId, CancellationToken cancellationToken)
    {
        var items = await InContainer(container)
            .Where(t => movingTicketId == null || t.Id != movingTicketId)
            .OrderBy(t => t.Rank).ThenBy(t => t.Id)
            .Select(t => new { t.Id, t.Rank })
            .ToListAsync(cancellationToken);

        var insertIndex = before is null ? 0 : items.FindLastIndex(i => string.CompareOrdinal(i.Rank, before) <= 0) + 1;

        var plan = Ranks.PlanRebalance(items.Count, insertIndex);
        var ids = items.Select(i => i.Id).ToArray();
        var ranks = plan.ExistingRanks.ToArray();
        await db.Database.ExecuteSqlAsync(
            $"UPDATE tickets AS t SET rank = v.rank FROM unnest({ids}, {ranks}) AS v(id, rank) WHERE t.id = v.id",
            cancellationToken);
        return plan.InsertedRank;
    }

    private IQueryable<Ticket> InContainer(RankContainer container)
    {
        var tickets = db.Tickets.AsNoTracking().Where(t => t.DeletedAt == null);
        return container switch
        {
            BacklogContainer backlog => tickets.Where(t => t.ProjectId == backlog.ProjectId && t.BoardId == null),
            BoardContainer board => tickets.Where(t => t.BoardId == board.BoardId),
            _ => throw new ArgumentOutOfRangeException(nameof(container)),
        };
    }
}
