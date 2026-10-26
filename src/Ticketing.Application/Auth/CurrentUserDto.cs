using Ticketing.Domain.Users;

namespace Ticketing.Application.Auth;

public sealed record CurrentUserDto(Guid Id, string Email, string DisplayName, GlobalRole GlobalRole);
