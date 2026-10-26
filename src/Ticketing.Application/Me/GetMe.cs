using Ticketing.Application.Abstractions;
using Ticketing.Application.Auth;

namespace Ticketing.Application.Me;

public static class GetMe
{
    public sealed record Query;

    public sealed class Handler(ICurrentUser currentUser) : IHandler<Query, CurrentUserDto>
    {
        public Task<CurrentUserDto> HandleAsync(Query request, CancellationToken cancellationToken) =>
            Task.FromResult(new CurrentUserDto(currentUser.Id, currentUser.Email, currentUser.DisplayName, currentUser.Role));
    }
}
