using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Ordering;
using Ticketing.Domain.Tickets;

namespace Ticketing.Infrastructure.Persistence;

internal sealed class TicketRanker(TicketingDbContext db) : ITicketRanker
{
    public async Task<string> BottomAsync(RankContainer container, IReadOnlyCollection<Guid>? movingTicketIds, CancellationToken cancellationToken)
    {
        await AdvisoryLocks.AcquireAsync(db, container.LockKey, cancellationToken);
        var last = await Others(container, movingTicketIds).OrderByDescending(t => t.Rank).Select(t => t.Rank).FirstOrDefaultAsync(cancellationToken);
        return await PlaceAsync(container, last, null, movingTicketIds, cancellationToken);
    }

    public async Task<string> TopAsync(RankContainer container, IReadOnlyCollection<Guid>? movingTicketIds, CancellationToken cancellationToken)
    {
        await AdvisoryLocks.AcquireAsync(db, container.LockKey, cancellationToken);
        var first = await Others(container, movingTicketIds).OrderBy(t => t.Rank).Select(t => t.Rank).FirstOrDefaultAsync(cancellationToken);
        return await PlaceAsync(container, null, first, movingTicketIds, cancellationToken);
    }

    public async Task<string> BetweenAsync(
        RankContainer container, string? before, string? after, IReadOnlyCollection<Guid>? movingTicketIds, CancellationToken cancellationToken)
    {
        await AdvisoryLocks.AcquireAsync(db, container.LockKey, cancellationToken);
        return await PlaceAsync(container, before, after, movingTicketIds, cancellationToken);
    }

    private async Task<string> PlaceAsync(
        RankContainer container, string? before, string? after, IReadOnlyCollection<Guid>? movingTicketIds, CancellationToken cancellationToken)
    {
        var rank = TryBetween(before, after);
        return rank is not null && !Ranks.NeedsRebalance(rank)
            ? rank
            : await RebalanceAsync(container, before, movingTicketIds, cancellationToken);
    }

    private static string? TryBetween(string? before, string? after)
    {
        if (before is not null && after is not null && string.CompareOrdinal(before, after) >= 0)
            return null;
        try
        {
            return Ranks.Between(before, after);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    /// <summary>Rewrites the container (except moving tickets) with short, evenly spaced ranks; returns the rank for the slot after <paramref name="before"/>.</summary>
    private async Task<string> RebalanceAsync(
        RankContainer container, string? before, IReadOnlyCollection<Guid>? movingTicketIds, CancellationToken cancellationToken)
    {
        var items = await Others(container, movingTicketIds)
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

    private IQueryable<Ticket> Others(RankContainer container, IReadOnlyCollection<Guid>? movingTicketIds)
    {
        var tickets = db.Tickets.AsNoTracking().Where(t => t.DeletedAt == null);
        if (movingTicketIds is { Count: > 0 })
            tickets = tickets.Where(t => !movingTicketIds.Contains(t.Id));
        return container switch
        {
            BacklogContainer backlog => tickets.Where(t => t.ProjectId == backlog.ProjectId && t.BoardId == null),
            BoardContainer board => tickets.Where(t => t.BoardId == board.BoardId),
            _ => throw new ArgumentOutOfRangeException(nameof(container)),
        };
    }
}
