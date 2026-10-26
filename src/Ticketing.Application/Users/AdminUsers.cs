using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Users;

/// <summary>Shared pieces of the user administration use cases: guards, the admin projection and the D-41 rules.</summary>
internal static class AdminUsers
{
    /// <summary>User, PAT and flag administration: Admins only, and only through the web session (spec 5.2, 5.5).</summary>
    public static void EnsureAdminWebSession(this ICurrentUser currentUser)
    {
        currentUser.EnsureCookieSession();
        currentUser.EnsureAdmin();
    }

    public static IQueryable<AdminUserDto> ToAdminDtos(this IQueryable<User> users, ITicketingDbContext db, DateTimeOffset now) =>
        users.Select(u => new AdminUserDto(
            u.Id,
            u.Email,
            u.DisplayName,
            u.GlobalRole,
            u.IsActive,
            u.PasswordHash != null,
            u.SetPasswordTokenHash != null && u.SetPasswordTokenExpiresAt > now ? u.SetPasswordTokenExpiresAt : null,
            u.LockedUntil > now ? u.LockedUntil : null,
            u.LastLoginAt,
            u.CreatedAt,
            u.DeactivatedAt,
            db.PersonalAccessTokens.Count(t => t.UserId == u.Id && t.RevokedAt == null && t.ExpiresAt > now),
            u.RowVersion));

    public static async Task<AdminUserDto> LoadAsync(ITicketingDbContext db, Guid userId, DateTimeOffset now, CancellationToken cancellationToken) =>
        await db.Users.AsNoTracking().Where(u => u.Id == userId).ToAdminDtos(db, now).SingleOrDefaultAsync(cancellationToken)
        ?? throw NotFound();

    public static async Task<User> FindTrackedAsync(ITicketingDbContext db, Guid userId, CancellationToken cancellationToken) =>
        await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken) ?? throw NotFound();

    public static AppException NotFound() => AppException.NotFound(UserErrors.NotFound, "The user was not found.");

    /// <summary>
    /// Fails with <c>user.lastAdmin</c> unless an active Admin other than <paramref name="userId"/> exists. Locks the active
    /// Admin rows until the transaction ends, so two Admins demoting each other concurrently cannot both succeed.
    /// </summary>
    public static async Task EnsureAnotherActiveAdminAsync(ITicketingDbContext db, Guid userId, CancellationToken cancellationToken)
    {
        var admins = await db.Users
            .FromSql($"SELECT *, xmin FROM users WHERE global_role = {(int)GlobalRole.Admin} AND is_active ORDER BY id FOR UPDATE")
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        if (!admins.Any(a => a.Id != userId))
            throw DomainException.Conflict(UserErrors.LastAdmin, "This is the last active administrator.", "Make another user an Admin first.");
    }

    /// <summary>Fails with <c>user.lastProjectOwner</c>, listing the project keys in <c>errors.projects</c> (spec 4.1, D-41).</summary>
    public static async Task EnsureNotLastProjectOwnerAsync(ITicketingDbContext db, Guid userId, CancellationToken cancellationToken)
    {
        // TODO: switch to ProjectOwnership.ProjectsSolelyOwnedByAsync once the projects slice lands on main.
        var projects = await db.Projects
            .AsNoTracking()
            .Where(p => p.DeletedAt == null && p.ArchivedAt == null)
            .Where(p => p.Members.Any(m => m.UserId == userId && m.Role == ProjectRole.Owner))
            .Where(p => !p.Members.Any(m => m.UserId != userId && m.Role == ProjectRole.Owner && db.Users.Any(u => u.Id == m.UserId && u.IsActive)))
            .OrderBy(p => p.Key)
            .Select(p => p.Key)
            .ToListAsync(cancellationToken);
        if (projects.Count == 0)
            return;
        throw new AppException(
            ErrorKind.Conflict,
            UserErrors.LastProjectOwner,
            $"The user is the last owner of {string.Join(", ", projects)}.",
            "Add another owner to these projects first.",
            new Dictionary<string, string[]> { ["projects"] = [.. projects] });
    }
}
