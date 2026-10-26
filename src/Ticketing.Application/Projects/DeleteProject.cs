using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.Projects;

/// <summary>
/// Soft-deletes an archived project (Admin only, web session only, spec 4.3 and 9.3). The caller confirms by typing the
/// project key. The key stays reserved; the name becomes free.
/// </summary>
public static class DeleteProject
{
    public sealed record Command(string ProjectKeyOrId, string? ConfirmKey);

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity) : IHandler<Command, bool>
    {
        public async Task<bool> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            currentUser.EnsureCookieSession();
            currentUser.EnsureAdmin();
            var grant = await access.EnsureOwnerAsync(command.ProjectKeyOrId, cancellationToken, allowArchived: true);

            var project = await db.Projects.SingleAsync(p => p.Id == grant.ProjectId, cancellationToken);
            project.Delete(currentUser.Id, clock.Now, command.ConfirmKey ?? string.Empty);
            activity.Record(ActivityEntityType.Project, project.Id, project.Id, "project.deleted", new { project.Key, project.Name });
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
    }
}
