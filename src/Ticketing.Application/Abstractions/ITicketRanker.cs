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

    /// <summary>
    /// Returns <paramref name="count"/> ordered ranks for a block of tickets placed at <paramref name="anchor"/>. The anchor's
    /// neighbours are read under the container lock, ignoring <paramref name="movingTicketIds"/>. Throws a
    /// <c>ticket.rank.anchor</c> conflict when an anchor ticket is not in the container (or is itself moving).
    /// </summary>
    Task<IReadOnlyList<string>> PlaceManyAsync(
        RankContainer container, RankAnchor anchor, int count, IReadOnlyCollection<Guid> movingTicketIds, CancellationToken cancellationToken);
}

/// <summary>Where a block of tickets goes inside its container: the top, the bottom, or right before or after another ticket.</summary>
public abstract record RankAnchor
{
    public static RankAnchor Top { get; } = new TopAnchor();

    public static RankAnchor Bottom { get; } = new BottomAnchor();

    public static RankAnchor Before(Guid ticketId) => new BeforeAnchor(ticketId);

    public static RankAnchor After(Guid ticketId) => new AfterAnchor(ticketId);
}

public sealed record TopAnchor : RankAnchor;

public sealed record BottomAnchor : RankAnchor;

public sealed record BeforeAnchor(Guid TicketId) : RankAnchor;

public sealed record AfterAnchor(Guid TicketId) : RankAnchor;

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
