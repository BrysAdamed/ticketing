using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Common;
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

    public async Task<IReadOnlyList<string>> PlaceManyAsync(
        RankContainer container, RankAnchor anchor, int count, IReadOnlyCollection<Guid> movingTicketIds, CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 1);
        await AdvisoryLocks.AcquireAsync(db, container.LockKey, cancellationToken);
        var others = Others(container, movingTicketIds);
        var (before, after) = anchor switch
        {
            TopAnchor => ((string?)null, await others.OrderBy(t => t.Rank).Select(t => t.Rank).FirstOrDefaultAsync(cancellationToken)),
            BottomAnchor => (await others.OrderByDescending(t => t.Rank).Select(t => t.Rank).FirstOrDefaultAsync(cancellationToken), (string?)null),
            BeforeAnchor b => await BeforeAsync(others, await AnchorRankAsync(others, b.TicketId, cancellationToken), cancellationToken),
            AfterAnchor a => await AfterAsync(others, await AnchorRankAsync(others, a.TicketId, cancellationToken), cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(anchor)),
        };

        var keys = TryManyBetween(before, after, count);
        return keys is not null && !keys.Any(Ranks.NeedsRebalance)
            ? keys
            : await RebalanceAsync(container, before, count, movingTicketIds, cancellationToken);
    }

    public async Task<string> ReuseOrPlaceAsync(
        RankContainer container, string rank, RankAnchor fallback, IReadOnlyCollection<Guid> movingTicketIds, CancellationToken cancellationToken)
    {
        await AdvisoryLocks.AcquireAsync(db, container.LockKey, cancellationToken);
        if (!Ranks.NeedsRebalance(rank) && !await Others(container, movingTicketIds).AnyAsync(t => t.Rank == rank, cancellationToken))
            return rank;
        return (await PlaceManyAsync(container, fallback, 1, movingTicketIds, cancellationToken))[0];
    }

    private static async Task<string> AnchorRankAsync(IQueryable<Ticket> others, Guid anchorId, CancellationToken cancellationToken) =>
        await others.Where(t => t.Id == anchorId).Select(t => t.Rank).FirstOrDefaultAsync(cancellationToken)
        ?? throw DomainException.Conflict(
            TicketErrors.RankAnchorInvalid, "The ticket to place next to is not in this list any more.", "Reload the list and try again.");

    private static async Task<(string? Before, string? After)> BeforeAsync(IQueryable<Ticket> others, string anchorRank, CancellationToken cancellationToken) =>
        (await others.Where(t => string.Compare(t.Rank, anchorRank) < 0).OrderByDescending(t => t.Rank).Select(t => t.Rank).FirstOrDefaultAsync(cancellationToken),
            anchorRank);

    private static async Task<(string? Before, string? After)> AfterAsync(IQueryable<Ticket> others, string anchorRank, CancellationToken cancellationToken) =>
        (anchorRank,
            await others.Where(t => string.Compare(t.Rank, anchorRank) > 0).OrderBy(t => t.Rank).Select(t => t.Rank).FirstOrDefaultAsync(cancellationToken));

    private async Task<string> PlaceAsync(
        RankContainer container, string? before, string? after, IReadOnlyCollection<Guid>? movingTicketIds, CancellationToken cancellationToken)
    {
        var rank = TryBetween(before, after);
        return rank is not null && !Ranks.NeedsRebalance(rank)
            ? rank
            : (await RebalanceAsync(container, before, 1, movingTicketIds, cancellationToken))[0];
    }

    private static IReadOnlyList<string>? TryManyBetween(string? before, string? after, int count)
    {
        if (before is not null && after is not null && string.CompareOrdinal(before, after) >= 0)
            return null;
        try
        {
            return FractionalIndex.NKeysBetween(before, after, count);
        }
        catch (ArgumentException)
        {
            return null;
        }
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

    /// <summary>Rewrites the container (except moving tickets) with short, evenly spaced ranks; returns the ranks for the slots after <paramref name="before"/>.</summary>
    private async Task<IReadOnlyList<string>> RebalanceAsync(
        RankContainer container, string? before, int insertCount, IReadOnlyCollection<Guid>? movingTicketIds, CancellationToken cancellationToken)
    {
        var items = await Others(container, movingTicketIds)
            .OrderBy(t => t.Rank).ThenBy(t => t.Id)
            .Select(t => new { t.Id, t.Rank })
            .ToListAsync(cancellationToken);

        var insertIndex = before is null ? 0 : items.FindLastIndex(i => string.CompareOrdinal(i.Rank, before) <= 0) + 1;
        var plan = Ranks.PlanRebalance(items.Count, insertIndex, insertCount);
        var ids = items.Select(i => i.Id).ToArray();
        var ranks = plan.ExistingRanks.ToArray();
        await db.Database.ExecuteSqlAsync(
            $"UPDATE tickets AS t SET rank = v.rank FROM unnest({ids}, {ranks}) AS v(id, rank) WHERE t.id = v.id",
            cancellationToken);
        return plan.InsertedRanks;
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
