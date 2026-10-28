using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Users;

/// <summary>
/// The avatar directory (D-129): every user who picked an avatar, deactivated users included, so the web app can draw
/// avatars next to any user reference without the avatar being part of each user DTO. Keys no longer in
/// <see cref="AvatarCatalog"/> are left out; a user left with neither key is not listed.
/// </summary>
public static class ListUserAvatars
{
    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db) : IHandler<Query, IReadOnlyList<UserAvatarDto>>
    {
        public async Task<IReadOnlyList<UserAvatarDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var stored = await db.Users.AsNoTracking()
                .Where(u => u.AvatarIcon != null || u.AvatarColor != null)
                .OrderBy(u => u.Id)
                .Select(u => new { u.Id, u.AvatarIcon, u.AvatarColor })
                .ToListAsync(cancellationToken);
            return stored
                .Select(u => new UserAvatarDto(
                    u.Id, AvatarCatalog.IsIcon(u.AvatarIcon) ? u.AvatarIcon : null, AvatarCatalog.IsColor(u.AvatarColor) ? u.AvatarColor : null))
                .Where(a => a.Icon is not null || a.Color is not null)
                .ToList();
        }
    }
}
