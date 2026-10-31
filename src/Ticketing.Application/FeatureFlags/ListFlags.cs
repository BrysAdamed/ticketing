using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Users;

namespace Ticketing.Application.FeatureFlags;

/// <summary>Every flag (a small table): the declared ones by key, then the retired ones, with how many active users evaluate on.</summary>
public static class ListFlags
{
    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, FeatureFlagSync sync, IFeatureFlagCatalog catalog)
        : IHandler<Query, IReadOnlyList<FlagDto>>
    {
        public async Task<IReadOnlyList<FlagDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            await sync.EnsureAsync(cancellationToken);
            var flags = await db.FeatureFlags.AsNoTracking().ToListAsync(cancellationToken);
            var ordered = flags.OrderBy(f => catalog.Find(f.Key) is null).ThenBy(f => f.Key, StringComparer.Ordinal).ToList();
            return await FlagAdmin.ToDtosAsync(db, catalog, ordered, cancellationToken);
        }
    }
}
