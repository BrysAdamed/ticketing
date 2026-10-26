using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Projects;

/// <summary>Adds an active user to a project (Owner only, spec 4.4 and 5.3).</summary>
public static class AddProjectMember
{
    /// <param name="User">The user's email or id.</param>
    public sealed record Command(string User, ProjectRole Role) : IValidatable
    {
        [JsonIgnore]
        public string ProjectKeyOrId { get; init; } = string.Empty;

        public void Validate(Validator validator) => validator
            .Required("user", User, Domain.Users.User.EmailMaxLength)
            .Must(Enum.IsDefined(Role), "role", "role must be Owner, Member or Viewer.");
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity) : IHandler<Command, ProjectMemberDto>
    {
        public async Task<ProjectMemberDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var grant = await access.EnsureOwnerAsync(command.ProjectKeyOrId, cancellationToken);
            var user = await FindUserAsync(command.User.Trim(), cancellationToken);
            if (!user.IsActive)
                throw AppException.Conflict(UserErrors.Inactive, $"{user.DisplayName} is deactivated and cannot be added.", "Reactivate the user first.");

            return await db.InTransactionAsync(async ct =>
            {
                var project = await ProjectMembership.LockAndLoadAsync(db, grant.ProjectId, ct);
                project.AddMember(user.Id, command.Role, currentUser.Id, clock.Now);
                activity.Record(ActivityEntityType.Project, project.Id, project.Id, "project.member.added", new { userId = user.Id, user.Email, role = command.Role });
                await db.SaveChangesAsync(ct);

                var members = await ProjectMembership.LoadMembersAsync(db, project.Id, project.Visibility, ct);
                return members.Single(m => m.UserId == user.Id);
            }, cancellationToken);
        }

        private async Task<UserRow> FindUserAsync(string reference, CancellationToken cancellationToken)
        {
            var users = db.Users.AsNoTracking();
            users = Guid.TryParse(reference, out var id)
                ? users.Where(u => u.Id == id)
                : users.Where(u => u.Email == reference.ToLowerInvariant());
            return await users.Select(u => new UserRow(u.Id, u.Email, u.DisplayName, u.IsActive)).SingleOrDefaultAsync(cancellationToken)
                ?? throw AppException.NotFound(UserErrors.NotFound, $"User '{reference}' was not found.");
        }

        private sealed record UserRow(Guid Id, string Email, string DisplayName, bool IsActive);
    }
}
