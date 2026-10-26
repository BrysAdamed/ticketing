using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Tokens;

/// <summary>Admin list of every user's tokens (never secrets), newest first, optionally for one user or one status.</summary>
public static class ListTokens
{
    public sealed record Query(Guid? UserId = null, PatStatus? Status = null, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock) : IHandler<Query, CursorPage<AdminPatDto>>
    {
        public async Task<CursorPage<AdminPatDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            var page = request.Page ?? new PageRequest();
            var after = Cursor.Decode<TimeCursor>(page.Cursor);
            var now = clock.Now;

            var tokens = db.PersonalAccessTokens.AsNoTracking();
            if (request.UserId is { } userId)
                tokens = tokens.Where(t => t.UserId == userId);
            tokens = request.Status switch
            {
                PatStatus.Active => tokens.Where(t => t.RevokedAt == null && t.ExpiresAt > now),
                PatStatus.Expired => tokens.Where(t => t.RevokedAt == null && t.ExpiresAt <= now),
                PatStatus.Revoked => tokens.Where(t => t.RevokedAt != null),
                _ => tokens,
            };
            if (after is not null)
                tokens = tokens.Where(t => EF.Functions.LessThan(ValueTuple.Create(t.CreatedAt, t.Id), ValueTuple.Create(after.At, after.Id)));

            return await tokens
                .Join(db.Users, t => t.UserId, u => u.Id, (t, u) => new { Token = t, User = u })
                .OrderByDescending(x => x.Token.CreatedAt)
                .ThenByDescending(x => x.Token.Id)
                .Select(x => new AdminPatDto(
                    x.Token.Id,
                    x.Token.Name,
                    x.Token.Prefix,
                    x.Token.Scope,
                    x.Token.RevokedAt != null ? PatStatus.Revoked : x.Token.ExpiresAt <= now ? PatStatus.Expired : PatStatus.Active,
                    x.Token.CreatedAt,
                    x.Token.ExpiresAt,
                    x.Token.LastUsedAt,
                    x.Token.RevokedAt,
                    new UserLookupDto(x.User.Id, x.User.Email, x.User.DisplayName, x.User.IsActive)))
                .ToCursorPageAsync(page, t => new TimeCursor(t.CreatedAt, t.Id), cancellationToken);
        }
    }

    private sealed record TimeCursor(DateTimeOffset At, Guid Id);
}
