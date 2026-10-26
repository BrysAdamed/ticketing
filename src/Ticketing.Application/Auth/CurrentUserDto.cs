using Ticketing.Domain.Users;

namespace Ticketing.Application.Auth;

public sealed record CurrentUserDto(Guid Id, string Email, string DisplayName, GlobalRole GlobalRole);

/// <summary>What a transport needs to (re)issue a cookie session: the user and the security stamp the session is bound to.</summary>
public sealed record SessionIdentity(CurrentUserDto User, string SecurityStamp)
{
    public static SessionIdentity For(User user) =>
        new(new CurrentUserDto(user.Id, user.Email, user.DisplayName, user.GlobalRole), user.SecurityStamp);
}
