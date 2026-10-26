using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.Projects;

/// <summary>Removes a membership (Owner only). Tickets assigned to the user stay assigned (spec 4.4).</summary>
public static class RemoveProjectMember
{
    public sealed record Command(string ProjectKeyOrId, Guid UserId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, IActivityLog activity) : IHandler<Command, bool>
    {
        public async Task<bool> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var grant = await access.EnsureOwnerAsync(command.ProjectKeyOrId, cancellationToken);

            return await db.InTransactionAsync(async ct =>
            {
                var project = await ProjectMembership.LockAndLoadAsync(db, grant.ProjectId, ct);
                ProjectMembership.EnsureIsMember(project, command.UserId);
                var activeIds = await ProjectMembership.ActiveMemberIdsAsync(db, project, ct);
                var removed = project.RemoveMember(command.UserId, activeIds);
                activity.Record(ActivityEntityType.Project, project.Id, project.Id, "project.member.removed", new { userId = removed.UserId, role = removed.Role });
                await db.SaveChangesAsync(ct);
                return true;
            }, cancellationToken);
        }
    }
}
