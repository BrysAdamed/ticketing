using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Users;

namespace Ticketing.Application.FeatureFlags;

/// <summary>All flags (a small table) with how many active users currently evaluate on.</summary>
public static class ListFlags
{
    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser) : IHandler<Query, IReadOnlyList<FlagDto>>
    {
        public async Task<IReadOnlyList<FlagDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            var flags = await db.FeatureFlags.AsNoTracking().OrderBy(f => f.Key).ToListAsync(cancellationToken);
            return await FlagAdmin.ToDtosAsync(db, flags, cancellationToken);
        }
    }
}
