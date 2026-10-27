using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.Projects;

/// <summary>
/// Unarchives a project (Owner only; the one write allowed on an archived project). Boards are not relinked. If no active
/// Owner is left, the acting Admin becomes an Owner (D-52).
/// </summary>
public static class UnarchiveProject
{
    public sealed record Command(string ProjectKeyOrId);

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity) : IHandler<Command, ProjectDto>
    {
        public async Task<ProjectDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var grant = await access.EnsureOwnerAsync(command.ProjectKeyOrId, cancellationToken, allowArchived: true);

            return await db.InTransactionAsync(async ct =>
            {
                var project = await ProjectMembership.LockAndLoadAsync(db, grant.ProjectId, ct);
                var activeIds = await ProjectMembership.ActiveMemberIdsAsync(db, project, ct);
                var newOwner = project.Unarchive(currentUser.Id, clock.Now, activeIds);

                activity.Record(ActivityEntityType.Project, project.Id, project.Id, "project.unarchived");
                if (newOwner is not null)
                {
                    var email = await ProjectMembership.EmailOfAsync(db, newOwner.UserId, ct);
                    activity.Record(ActivityEntityType.Project, project.Id, project.Id, "project.member.ownerRestored", new { userId = newOwner.UserId, email, role = newOwner.Role });
                }
                await db.SaveChangesAsync(ct);
                return await GetProject.Handler.LoadAsync(db, grant with { IsArchived = false }, ct);
            }, cancellationToken);
        }
    }
}
