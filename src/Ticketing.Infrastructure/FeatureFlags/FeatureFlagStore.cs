using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Infrastructure.FeatureFlags;

/// <summary>
/// Loads all flags (a small table) and caches them for 30 seconds per instance. Admin edits call <see cref="Invalidate"/>;
/// other API instances pick changes up when their cache expires.
/// </summary>
internal sealed class FeatureFlagStore(IServiceScopeFactory scopes, IMemoryCache cache) : IFeatureFlagStore
{
    private const string CacheKey = "ticketing:feature-flags";
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(30);

    public async Task<IReadOnlyList<FeatureFlag>> GetAllAsync(CancellationToken cancellationToken) =>
        await cache.GetOrCreateAsync(CacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = Ttl;
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<TicketingDbContext>();
            return (IReadOnlyList<FeatureFlag>)await db.FeatureFlags.AsNoTracking().OrderBy(f => f.Key).ToListAsync(cancellationToken);
        }) ?? [];

    public void Invalidate() => cache.Remove(CacheKey);
}
