using Ticketing.Domain.Ordering;

namespace Ticketing.Application.Abstractions;

public static class TicketRankerExtensions
{
    /// <summary>
    /// <paramref name="count"/> ordered ranks above the current top of <paramref name="container"/>, for placing several
    /// tickets at the top while keeping their relative order (spec 6.4: tickets returned to the backlog go to the top).
    /// Same transaction and locking rules as <see cref="ITicketRanker.TopAsync"/>.
    /// </summary>
    public static async Task<IReadOnlyList<string>> TopManyAsync(
        this ITicketRanker ranker, RankContainer container, int count, IReadOnlyCollection<Guid> movingTicketIds, CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(count);
        if (count == 0)
            return [];
        var last = await ranker.TopAsync(container, movingTicketIds, cancellationToken);
        return [.. FractionalIndex.NKeysBetween(null, last, count - 1), last];
    }
}
