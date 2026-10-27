using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>
/// An Owner sets how the project handles a ticket type: Inherit (the instance default), Custom (its own body) or Off. Every
/// save is a new version; <c>baseVersion</c> is the version the editor started from (0 for a type that never left Inherit),
/// and a stale one fails with <c>agent.prompt.versionConflict</c>.
/// </summary>
public static class SaveProjectAgentPrompt
{
    public sealed record Command : IValidatable
    {
        [JsonIgnore]
        public string ProjectKeyOrId { get; init; } = string.Empty;

        [JsonIgnore]
        public string Type { get; init; } = string.Empty;

        public AgentPromptMode Mode { get; init; }

        public string? Body { get; init; }

        public string? ChangeNote { get; init; }

        public int BaseVersion { get; init; }

        public void Validate(Validator validator) => validator
            .Must(Enum.IsDefined(Mode), "mode", "mode must be Inherit, Custom or Off.")
            .MaxLength("changeNote", ChangeNote, AgentPromptTemplate.ChangeNoteMaxLength)
            .Range("baseVersion", BaseVersion, 0, int.MaxValue);
    }

    public sealed class Handler(
        ITicketingDbContext db, AgentPromptAccess agents, AgentPromptComposer composer, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, ProjectAgentPromptDto>
    {
        public async Task<ProjectAgentPromptDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await agents.WriteAsync(command.ProjectKeyOrId, command.Type, cancellationToken);
            command.EnsureValid();
            var projectId = target.Project!.ProjectId;
            var instance = await AgentPromptQueries.InstanceAsync(db, cancellationToken);

            var template = await AgentPromptQueries.For(db, target).SingleOrDefaultAsync(cancellationToken);
            if (template is null)
            {
                AgentPromptTemplate.EnsureBaseVersion(0, command.BaseVersion);
                template = AgentPromptTemplate.CreateForProject(projectId, target.Type, clock.Now);
                db.AgentPromptTemplates.Add(template);
            }
            else
            {
                template.EnsureBaseVersion(command.BaseVersion);
            }

            var (previousVersion, previousMode) = (template.CurrentVersion, template.Mode);
            var version = template.Save(command.Mode, command.Body, command.ChangeNote, instance[target.Slot].CurrentVersion, currentUser.Id, clock.Now);
            await AgentPromptWrites.EnsureProjectFitsAsync(db, composer, template, instance[AgentPromptSlot.Guardrails], cancellationToken);
            db.AgentPromptTemplateVersions.Add(version);
            AgentPromptWrites.RecordUpdated(activity, template, previousVersion, previousMode);
            await AgentPromptWrites.SaveAsync(db, cancellationToken);
            return await AgentPromptQueries.ProjectDtoAsync(db, projectId, target.Type, cancellationToken);
        }
    }
}
