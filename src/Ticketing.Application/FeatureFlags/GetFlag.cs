using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Users;

namespace Ticketing.Application.FeatureFlags;

public static class GetFlag
{
    public sealed record Query(string Key);

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, FeatureFlagSync sync, IFeatureFlagCatalog catalog)
        : IHandler<Query, FlagDto>
    {
        public async Task<FlagDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            await sync.EnsureAsync(cancellationToken);
            var key = request.Key.Trim();
            var flag = await db.FeatureFlags.AsNoTracking().SingleOrDefaultAsync(f => f.Key == key, cancellationToken) ?? throw FlagAdmin.NotFound(key);
            return (await FlagAdmin.ToDtosAsync(db, catalog, [flag], cancellationToken))[0];
        }
    }
}
