using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Projects;

/// <summary>Queries behind the "at least one active Owner" invariant (spec 4.1, 4.3, D-41).</summary>
public static class ProjectOwnership
{
    /// <summary>
    /// Keys of the non-archived, non-deleted projects where <paramref name="userId"/> is the only active Owner member.
    /// Deactivating that user must fail with <c>user.lastProjectOwner</c> while this is not empty.
    /// </summary>
    public static Task<List<string>> ProjectsSolelyOwnedByAsync(ITicketingDbContext db, Guid userId, CancellationToken cancellationToken) =>
        db.Projects
            .AsNoTracking()
            .Where(p => p.DeletedAt == null && p.ArchivedAt == null)
            .Where(p => p.Members.Any(m => m.UserId == userId && m.Role == ProjectRole.Owner))
            .Where(p => !p.Members.Any(m => m.UserId != userId && m.Role == ProjectRole.Owner && db.Users.Any(u => u.Id == m.UserId && u.IsActive)))
            .OrderBy(p => p.Key)
            .Select(p => p.Key)
            .ToListAsync(cancellationToken);
}
