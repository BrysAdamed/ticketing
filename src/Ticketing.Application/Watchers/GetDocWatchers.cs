using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Watchers;

/// <summary>Who watches a page or diagram (I-85, D-161): only active users who can read its project are listed.</summary>
public static class GetDocWatchers
{
    public sealed record Query(string DocKeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, WatchersDto>
    {
        public async Task<WatchersDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var doc = await DocWatcherQueries.WatchableAsync(db, access, request.DocKeyOrId, cancellationToken);
            return await DocWatcherQueries.LoadAsync(db, currentUser, doc, cancellationToken);
        }
    }
}
