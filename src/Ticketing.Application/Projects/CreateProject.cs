using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Agents;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Projects;

/// <summary>
/// Reference write use case: validate the shape, check permissions, enforce uniqueness, create through the domain,
/// write activity, save once, and replay the result for a repeated idempotency key.
/// </summary>
public static partial class CreateProject
{
    public sealed record Command(
        string Key,
        string Name,
        string? Description = null,
        ProjectVisibility? Visibility = null,
        [property: JsonIgnore] string? IdempotencyKey = null) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Required("key", Key, Project.KeyMaxLength)
            .Matches("key", Key, KeyPattern(), "Project key must be 2-10 upper-case letters or digits, starting with a letter.")
            .Required("name", Name, Project.NameMaxLength)
            .MaxLength("description", Description, Project.DescriptionMaxLength);
    }

    public sealed class Handler(
        ITicketingDbContext db,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        IIdempotency idempotency,
        AgentGate agents) : IHandler<Command, ProjectDto>
    {
        public Task<ProjectDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureWriteScope();
            return idempotency.ExecuteAsync(
                command.IdempotencyKey, "projects.create", command with { IdempotencyKey = null },
                ct => CreateAsync(command, ct), cancellationToken);
        }

        private async Task<ProjectDto> CreateAsync(Command command, CancellationToken cancellationToken)
        {
            var project = Project.Create(command.Key, command.Name, command.Description, command.Visibility ?? ProjectVisibility.Private, currentUser.Id, clock.Now);
            await ProjectUniqueness.EnsureKeyIsFreeAsync(db, project.Key, cancellationToken);
            await ProjectUniqueness.EnsureNameIsFreeAsync(db, project.Name, null, cancellationToken);

            db.Projects.Add(project);
            activity.Record(ActivityEntityType.Project, project.Id, project.Id, "project.created", new { project.Key, project.Name, project.Visibility });
            await ProjectUniqueness.SaveAsync(db, project, cancellationToken);

            var grant = new ProjectAccessGrant(project.Id, project.Key, ProjectRole.Owner, project.Visibility, IsArchived: false);
            return await GetProject.Handler.LoadAsync(db, agents, grant, cancellationToken);
        }
    }

    [GeneratedRegex("^[A-Z][A-Z0-9]{1,9}$", RegexOptions.CultureInvariant)]
    private static partial Regex KeyPattern();
}
