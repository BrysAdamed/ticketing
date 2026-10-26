using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;

namespace Ticketing.Application.Tokens;

/// <summary>
/// The caller's tokens, newest first. Revoked and expired ones stay listed until the retention job purges them after
/// 90 days, so the list stays small and is returned without paging.
/// </summary>
public static class ListMyTokens
{
    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock) : IHandler<Query, IReadOnlyList<PatDto>>
    {
        public async Task<IReadOnlyList<PatDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            currentUser.EnsureCookieSession();
            var userId = currentUser.Id;
            return await db.PersonalAccessTokens
                .AsNoTracking()
                .Where(t => t.UserId == userId)
                .OrderByDescending(t => t.CreatedAt)
                .ThenByDescending(t => t.Id)
                .Select(PatProjections.ToDto(clock.Now))
                .ToListAsync(cancellationToken);
        }
    }
}
