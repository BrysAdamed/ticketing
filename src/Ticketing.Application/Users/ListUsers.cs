using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Users;

/// <summary>Admin user list: search by name or email, filter by active and role, ordered by display name then email.</summary>
public static class ListUsers
{
    public sealed record Query(string? Search = null, bool? IsActive = null, GlobalRole? Role = null, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock) : IHandler<Query, CursorPage<AdminUserDto>>
    {
        public async Task<CursorPage<AdminUserDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            var page = request.Page ?? new PageRequest();
            var after = Cursor.Decode<NameCursor>(page.Cursor);

            var users = db.Users.AsNoTracking();
            if (request.IsActive is { } isActive)
                users = users.Where(u => u.IsActive == isActive);
            if (request.Role is { } role)
                users = users.Where(u => u.GlobalRole == role);
            if (!string.IsNullOrWhiteSpace(request.Search))
            {
                var pattern = SqlLike.Contains(request.Search.Trim());
                users = users.Where(u => EF.Functions.ILike(u.DisplayName, pattern) || EF.Functions.ILike(u.Email, pattern));
            }
            if (after is not null)
                users = users.Where(u => string.Compare(u.DisplayName, after.Name) > 0 || (u.DisplayName == after.Name && string.Compare(u.Email, after.Email) > 0));

            return await users
                .OrderBy(u => u.DisplayName)
                .ThenBy(u => u.Email)
                .ToAdminDtos(db, clock.Now)
                .ToCursorPageAsync(page, u => new NameCursor(u.DisplayName, u.Email), cancellationToken);
        }
    }

    private sealed record NameCursor(string Name, string Email);
}
