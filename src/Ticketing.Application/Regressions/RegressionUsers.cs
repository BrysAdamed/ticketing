using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Regressions;

/// <summary>Resolves user references (id, email or <c>me</c>) for regression items: assignees and the assignee filter.</summary>
internal static class RegressionUsers
{
    public const string Me = "me";
    public const string Unassigned = "unassigned";

    /// <summary>An active user who can write to the project (spec 6.11: Owners assign items to any user with write access).</summary>
    public static async Task<Guid> AssigneeAsync(
        ITicketingDbContext db, ICurrentUser currentUser, ProjectAccessGrant project, string reference, CancellationToken cancellationToken)
    {
        var user = await Users(db, currentUser, reference)
                .Select(u => new { u.Id, u.DisplayName, u.IsActive, u.GlobalRole })
                .SingleOrDefaultAsync(cancellationToken)
            ?? throw Invalid($"User '{reference.Trim()}' was not found.");
        if (!user.IsActive)
            throw Invalid($"{user.DisplayName} is deactivated and cannot be assigned.");

        var userId = user.Id;
        var membership = await db.ProjectMembers
            .Where(m => m.ProjectId == project.ProjectId && m.UserId == userId)
            .Select(m => (ProjectRole?)m.Role)
            .FirstOrDefaultAsync(cancellationToken);
        if (!ProjectAccessPolicy.CanWrite(ProjectAccessPolicy.Effective(user.IsActive, user.GlobalRole, project.Visibility, membership)))
            throw Invalid($"{user.DisplayName} cannot write to {project.ProjectKey}, so they cannot be assigned.", "Add them to the project as a Member first.");
        return user.Id;
    }

    /// <summary>The user id an assignee filter means; null for <c>unassigned</c>; an empty id when nobody matches.</summary>
    public static async Task<Guid?> FilterAsync(ITicketingDbContext db, ICurrentUser currentUser, string reference, CancellationToken cancellationToken)
    {
        if (string.Equals(reference.Trim(), Unassigned, StringComparison.OrdinalIgnoreCase))
            return null;
        return await Users(db, currentUser, reference).Select(u => u.Id).SingleOrDefaultAsync(cancellationToken);
    }

    private static IQueryable<User> Users(ITicketingDbContext db, ICurrentUser currentUser, string reference)
    {
        var value = reference.Trim();
        if (string.Equals(value, Me, StringComparison.OrdinalIgnoreCase))
        {
            var me = currentUser.Id;
            return db.Users.AsNoTracking().Where(u => u.Id == me);
        }
        if (Guid.TryParse(value, out var id))
            return db.Users.AsNoTracking().Where(u => u.Id == id);
        var email = value.ToLowerInvariant();
        return db.Users.AsNoTracking().Where(u => u.Email == email);
    }

    private static AppException Invalid(string message, string? hint = null) =>
        new(ErrorKind.Validation, RegressionErrors.AssigneeInvalid, message, hint, new Dictionary<string, string[]> { ["assignee"] = [message] });
}
