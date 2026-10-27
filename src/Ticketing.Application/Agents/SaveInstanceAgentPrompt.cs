using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>
/// An Admin edits an instance default or the guardrails (an empty body removes the guardrails). The row stops following the
/// built-ins until it is reset to them. A stale <c>baseVersion</c> fails with <c>agent.prompt.versionConflict</c>.
/// </summary>
public static class SaveInstanceAgentPrompt
{
    public sealed record Command : IValidatable
    {
        [JsonIgnore]
        public string Slot { get; init; } = string.Empty;

        public string? Body { get; init; }

        public string? ChangeNote { get; init; }

        public int BaseVersion { get; init; }

        public void Validate(Validator validator) => validator
            .MaxLength("changeNote", ChangeNote, AgentPromptTemplate.ChangeNoteMaxLength)
            .Range("baseVersion", BaseVersion, 0, int.MaxValue);
    }

    public sealed class Handler(
        ITicketingDbContext db, AgentPromptAccess agents, AgentPromptComposer composer, IBuiltInAgentPrompts builtIns, ICurrentUser currentUser,
        IClock clock, IActivityLog activity)
        : IHandler<Command, InstanceAgentPromptDto>
    {
        public async Task<InstanceAgentPromptDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await agents.WriteAsync(null, command.Slot, cancellationToken);
            command.EnsureValid();
            var instance = await AgentPromptQueries.InstanceAsync(db, cancellationToken);

            var template = await AgentPromptQueries.For(db, target).SingleAsync(cancellationToken);
            template.EnsureBaseVersion(command.BaseVersion);
            var (previousVersion, previousMode) = (template.CurrentVersion, template.Mode);
            var version = template.Save(AgentPromptMode.Custom, command.Body, command.ChangeNote, null, currentUser.Id, clock.Now);
            AgentPromptWrites.EnsureInstanceFits(composer, template, instance);
            db.AgentPromptTemplateVersions.Add(version);
            AgentPromptWrites.RecordUpdated(activity, template, previousVersion, previousMode);
            await AgentPromptWrites.SaveAsync(db, cancellationToken);
            return await AgentPromptQueries.InstanceDtoAsync(db, builtIns, target.Slot, cancellationToken);
        }
    }
}
