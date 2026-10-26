using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Projects;

/// <summary>
/// Reference PATCH use case: omitted fields stay unchanged (<see cref="Optional{T}"/>), an optional expected version
/// gives optimistic concurrency, and every changed field writes one activity entry.
/// </summary>
public static class UpdateProject
{
    public sealed record Command : IValidatable
    {
        /// <summary>Project key or id, from the route.</summary>
        [JsonIgnore]
        public string ProjectKeyOrId { get; init; } = string.Empty;

        public Optional<string> Name { get; init; }

        public Optional<string?> Description { get; init; }

        public Optional<ProjectVisibility> Visibility { get; init; }

        [JsonIgnore]
        public uint? ExpectedVersion { get; init; }

        public void Validate(Validator validator)
        {
            if (Name.HasValue)
                validator.Required("name", Name.Value, Project.NameMaxLength);
            if (Description.HasValue)
                validator.MaxLength("description", Description.Value, Project.DescriptionMaxLength);
        }
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        IActivityLog activity) : IHandler<Command, ProjectDto>
    {
        public async Task<ProjectDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var grant = await access.EnsureOwnerAsync(command.ProjectKeyOrId, cancellationToken);
            var project = await db.Projects.SingleAsync(p => p.Id == grant.ProjectId, cancellationToken);
            db.ExpectVersion(project, command.ExpectedVersion);

            if (command.Name.HasValue)
            {
                var oldName = project.Name;
                project.Rename(command.Name.Value);
                await ProjectUniqueness.EnsureNameIsFreeAsync(db, project.Name, project.Id, cancellationToken);
                activity.RecordChange(ActivityEntityType.Project, project.Id, project.Id, "project.field.changed", "name", oldName, project.Name);
            }

            if (command.Description.HasValue)
            {
                var oldDescription = project.Description;
                project.ChangeDescription(command.Description.Value);
                activity.RecordChange(ActivityEntityType.Project, project.Id, project.Id, "project.field.changed", "description", oldDescription, project.Description);
            }

            if (command.Visibility.HasValue)
            {
                var oldVisibility = project.Visibility;
                project.ChangeVisibility(command.Visibility.Value);
                activity.RecordChange(ActivityEntityType.Project, project.Id, project.Id, "project.field.changed", "visibility", oldVisibility, project.Visibility);
            }

            await ProjectUniqueness.SaveAsync(db, project, cancellationToken);
            return await GetProject.Handler.LoadAsync(db, grant with { Visibility = project.Visibility }, cancellationToken);
        }
    }
}
