using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>
/// "Reset to default": the type goes back to Inherit as a new version, so the custom text stays recoverable in the history.
/// A type that already inherits is left as it is.
/// </summary>
public static class ResetProjectAgentPrompt
{
    public sealed record Command : IValidatable
    {
        [JsonIgnore]
        public string ProjectKeyOrId { get; init; } = string.Empty;

        [JsonIgnore]
        public string Type { get; init; } = string.Empty;

        public string? ChangeNote { get; init; }

        public int BaseVersion { get; init; }

        public void Validate(Validator validator) => validator
            .MaxLength("changeNote", ChangeNote, AgentPromptTemplate.ChangeNoteMaxLength)
            .Range("baseVersion", BaseVersion, 0, int.MaxValue);
    }

    public sealed class Handler(ITicketingDbContext db, AgentPromptAccess agents, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, ProjectAgentPromptDto>
    {
        public async Task<ProjectAgentPromptDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await agents.WriteAsync(command.ProjectKeyOrId, command.Type, cancellationToken);
            command.EnsureValid();
            var projectId = target.Project!.ProjectId;

            var template = await AgentPromptQueries.For(db, target).SingleOrDefaultAsync(cancellationToken);
            AgentPromptTemplate.EnsureBaseVersion(template?.CurrentVersion ?? 0, command.BaseVersion);
            if (template is not null && template.Mode != AgentPromptMode.Inherit)
            {
                var (previousVersion, previousMode) = (template.CurrentVersion, template.Mode);
                db.AgentPromptTemplateVersions.Add(template.Save(AgentPromptMode.Inherit, null, command.ChangeNote, null, currentUser.Id, clock.Now));
                AgentPromptWrites.RecordUpdated(activity, template, previousVersion, previousMode);
                await AgentPromptWrites.SaveAsync(db, cancellationToken);
            }
            return await AgentPromptQueries.ProjectDtoAsync(db, projectId, target.Type, cancellationToken);
        }
    }
}
