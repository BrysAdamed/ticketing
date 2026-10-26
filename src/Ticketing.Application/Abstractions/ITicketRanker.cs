namespace Ticketing.Application.Abstractions;

/// <summary>
/// Computes ticket ranks inside a container (a project backlog or a board, spec 6.6). Rebalances the container in the
/// current transaction when a key would exceed the threshold, so call it inside the transaction that saves the move.
/// </summary>
public interface ITicketRanker
{
    Task<string> BottomAsync(RankContainer container, CancellationToken cancellationToken);

    Task<string> TopAsync(RankContainer container, CancellationToken cancellationToken);

    /// <param name="before">Rank of the neighbour above the target slot, or null for the top.</param>
    /// <param name="after">Rank of the neighbour below the target slot, or null for the bottom.</param>
    /// <param name="movingTicketId">The ticket being placed, excluded when rebalancing.</param>
    Task<string> BetweenAsync(RankContainer container, string? before, string? after, Guid? movingTicketId, CancellationToken cancellationToken);
}

public abstract record RankContainer
{
    public static RankContainer Backlog(Guid projectId) => new BacklogContainer(projectId);

    public static RankContainer Board(Guid boardId) => new BoardContainer(boardId);
}

public sealed record BacklogContainer(Guid ProjectId) : RankContainer;

public sealed record BoardContainer(Guid BoardId) : RankContainer;
