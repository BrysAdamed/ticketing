namespace Ticketing.Application.Abstractions;

/// <summary>
/// Computes ticket ranks inside a container (a project backlog or a board, spec 6.6). Must run inside
/// <c>InTransactionAsync</c>: each call takes a per-container lock held until commit, so concurrent placements into the
/// same container get distinct, ordered ranks. When a key would get too long, or the neighbours are equal or out of
/// order, the container is rebalanced in place (one UPDATE). Tickets in <c>movingTicketIds</c> are never rewritten by a
/// rebalance, so the tracked entities being moved stay consistent; do not keep other tickets of the container tracked.
/// </summary>
public interface ITicketRanker
{
    Task<string> BottomAsync(RankContainer container, IReadOnlyCollection<Guid>? movingTicketIds, CancellationToken cancellationToken);

    Task<string> TopAsync(RankContainer container, IReadOnlyCollection<Guid>? movingTicketIds, CancellationToken cancellationToken);

    /// <param name="before">Rank of the neighbour above the target slot, or null for the top.</param>
    /// <param name="after">Rank of the neighbour below the target slot, or null for the bottom.</param>
    Task<string> BetweenAsync(
        RankContainer container, string? before, string? after, IReadOnlyCollection<Guid>? movingTicketIds, CancellationToken cancellationToken);
}

public abstract record RankContainer
{
    public static RankContainer Backlog(Guid projectId) => new BacklogContainer(projectId);

    public static RankContainer Board(Guid boardId) => new BoardContainer(boardId);

    public abstract string LockKey { get; }
}

public sealed record BacklogContainer(Guid ProjectId) : RankContainer
{
    public override string LockKey => $"rank:backlog:{ProjectId}";
}

public sealed record BoardContainer(Guid BoardId) : RankContainer
{
    public override string LockKey => $"rank:board:{BoardId}";
}
