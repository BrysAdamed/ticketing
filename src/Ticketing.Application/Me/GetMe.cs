using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Auth;

namespace Ticketing.Application.Me;

public static class GetMe
{
    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser) : IHandler<Query, CurrentUserDto>
    {
        public async Task<CurrentUserDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var hidden = await db.Users.AsNoTracking().Where(u => u.Id == currentUser.Id).Select(u => u.AchievementsHidden).SingleAsync(cancellationToken);
            return new CurrentUserDto(currentUser.Id, currentUser.Email, currentUser.DisplayName, currentUser.Role, hidden);
        }
    }
}
