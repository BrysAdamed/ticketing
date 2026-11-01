namespace Ticketing.Application.Abstractions;

/// <summary>
/// Computes fractional-index ranks inside a container (spec 6.6): a project backlog or a board for tickets, a docs folder
/// (or the docs root) for doc nodes (D-108). Must run inside <c>InTransactionAsync</c>: each call takes a per-container lock
/// held until commit, so concurrent placements into the same container get distinct, ordered ranks. When a key would get
/// too long, or the neighbours are equal or out of order, the container is rebalanced in place (one UPDATE). Items in
/// <c>movingTicketIds</c> (tickets or doc nodes) are never rewritten by a rebalance, so the tracked entities being moved
/// stay consistent; do not keep other items of the container tracked.
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
    /// Returns <paramref name="count"/> ordered ranks for a block of items placed at <paramref name="anchor"/>. The anchor's
    /// neighbours are read under the container lock, ignoring <paramref name="movingTicketIds"/>. Throws a
    /// <c>ticket.rank.anchor</c> (or <c>doc.rank.anchor</c>) conflict when the anchor is not in the container (or is itself moving).
    /// </summary>
    Task<IReadOnlyList<string>> PlaceManyAsync(
        RankContainer container, RankAnchor anchor, int count, IReadOnlyCollection<Guid> movingTicketIds, CancellationToken cancellationToken);

    /// <summary>
    /// Returns <paramref name="rank"/> when no other item of the container holds it (checked under the container lock), so an
    /// item can go back to where it was; otherwise a rank at <paramref name="fallback"/>, as <see cref="PlaceManyAsync"/> gives.
    /// </summary>
    Task<string> ReuseOrPlaceAsync(
        RankContainer container, string rank, RankAnchor fallback, IReadOnlyCollection<Guid> movingTicketIds, CancellationToken cancellationToken);

    /// <summary>
    /// Takes the locks of several containers up front, in one fixed order (backlogs by project id, then boards by board id,
    /// then docs trees by project id), so a writer can lock every container it reads from or places into before it locks
    /// item rows (D-179). Placing into a locked container later does not wait again.
    /// </summary>
    Task LockAsync(IEnumerable<RankContainer> containers, CancellationToken cancellationToken);
}

/// <summary>Where a block of items goes inside its container: the top, the bottom, or right before or after another item.</summary>
public abstract record RankAnchor
{
    public static RankAnchor Top { get; } = new TopAnchor();

    public static RankAnchor Bottom { get; } = new BottomAnchor();

    public static RankAnchor Before(Guid itemId) => new BeforeAnchor(itemId);

    public static RankAnchor After(Guid itemId) => new AfterAnchor(itemId);
}

public sealed record TopAnchor : RankAnchor;

public sealed record BottomAnchor : RankAnchor;

public sealed record BeforeAnchor(Guid ItemId) : RankAnchor;

public sealed record AfterAnchor(Guid ItemId) : RankAnchor;

public abstract record RankContainer
{
    public static RankContainer Backlog(Guid projectId) => new BacklogContainer(projectId);

    public static RankContainer Board(Guid boardId) => new BoardContainer(boardId);

    /// <summary>The children of a docs folder, or the docs root of the project when <paramref name="parentId"/> is null.</summary>
    public static RankContainer DocFolder(Guid projectId, Guid? parentId) => new DocFolderContainer(projectId, parentId);

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

/// <summary>Locks the project's whole docs tree (<see cref="TreeLockKey"/>), the same lock tree changes take before their checks.</summary>
public sealed record DocFolderContainer(Guid ProjectId, Guid? ParentId) : RankContainer
{
    public override string LockKey => TreeLockKey(ProjectId);

    public static string TreeLockKey(Guid projectId) => $"docs:tree:{projectId}";
}
