using Ticketing.Domain.Users;

namespace Ticketing.Application.Auth;

/// <param name="AchievementsHidden">The user opted out of achievements (spec 15.11).</param>
public sealed record CurrentUserDto(Guid Id, string Email, string DisplayName, GlobalRole GlobalRole, bool AchievementsHidden)
{
    public static CurrentUserDto For(User user) => new(user.Id, user.Email, user.DisplayName, user.GlobalRole, user.AchievementsHidden);
}

/// <summary>What a transport needs to (re)issue a cookie session: the user and the security stamp the session is bound to.</summary>
public sealed record SessionIdentity(CurrentUserDto User, string SecurityStamp)
{
    public static SessionIdentity For(User user) => new(CurrentUserDto.For(user), user.SecurityStamp);
}
