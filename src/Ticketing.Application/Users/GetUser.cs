using Ticketing.Application.Abstractions;

namespace Ticketing.Application.Users;

public static class GetUser
{
    public sealed record Query(Guid UserId);

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock) : IHandler<Query, AdminUserDto>
    {
        public Task<AdminUserDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            return AdminUsers.LoadAsync(db, request.UserId, clock.Now, cancellationToken);
        }
    }
}
