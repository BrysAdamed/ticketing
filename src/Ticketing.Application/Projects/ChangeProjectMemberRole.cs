using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Projects;

/// <summary>Changes a member's project role (Owner only). The project must keep an active Owner (spec 4.3).</summary>
public static class ChangeProjectMemberRole
{
    public sealed record Command(ProjectRole Role) : IValidatable
    {
        [JsonIgnore]
        public string ProjectKeyOrId { get; init; } = string.Empty;

        [JsonIgnore]
        public Guid UserId { get; init; }

        public void Validate(Validator validator) =>
            validator.Must(Enum.IsDefined(Role), "role", "role must be Owner, Member or Viewer.");
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, IActivityLog activity) : IHandler<Command, ProjectMemberDto>
    {
        public async Task<ProjectMemberDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var grant = await access.EnsureOwnerAsync(command.ProjectKeyOrId, cancellationToken);

            return await db.InTransactionAsync(async ct =>
            {
                var project = await ProjectMembership.LockAndLoadAsync(db, grant.ProjectId, ct);
                ProjectMembership.EnsureIsMember(project, command.UserId);
                var activeIds = await ProjectMembership.ActiveMemberIdsAsync(db, project, ct);
                var previous = project.ChangeMemberRole(command.UserId, command.Role, activeIds);
                var email = await ProjectMembership.EmailOfAsync(db, command.UserId, ct);
                activity.RecordChange(ActivityEntityType.Project, project.Id, project.Id, "project.member.roleChanged", "role",
                    new { userId = command.UserId, email, role = previous }, new { userId = command.UserId, email, role = command.Role });
                await db.SaveChangesAsync(ct);

                var members = await ProjectMembership.LoadMembersAsync(db, project.Id, project.Visibility, ct);
                return members.Single(m => m.UserId == command.UserId);
            }, cancellationToken);
        }
    }
}
