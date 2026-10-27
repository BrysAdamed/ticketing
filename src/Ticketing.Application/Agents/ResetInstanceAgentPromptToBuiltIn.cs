using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>
/// "Reset to built-in" (also "Adopt" a newer built-in): the shipped text becomes a new version and the row follows the
/// built-ins again, so later releases upgrade it automatically.
/// </summary>
public static class ResetInstanceAgentPromptToBuiltIn
{
    public sealed record Command : IValidatable
    {
        [JsonIgnore]
        public string Slot { get; init; } = string.Empty;

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
            var version = template.AdoptBuiltIn(builtIns.For(target.Slot), currentUser.Id, clock.Now, command.ChangeNote);
            AgentPromptWrites.EnsureInstanceFits(composer, template, instance);
            db.AgentPromptTemplateVersions.Add(version);
            AgentPromptWrites.RecordUpdated(activity, template, previousVersion, previousMode);
            await AgentPromptWrites.SaveAsync(db, cancellationToken);
            return await AgentPromptQueries.InstanceDtoAsync(db, builtIns, target.Slot, cancellationToken);
        }
    }
}
