using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;

namespace Ticketing.Application.Watchers;

/// <summary>Who watches a ticket (I-32): only active users who can read its project are listed.</summary>
public static class GetWatchers
{
    public sealed record Query(string KeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, WatchersDto>
    {
        public async Task<WatchersDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            return await WatcherQueries.LoadAsync(db, currentUser, target, cancellationToken);
        }
    }
}
