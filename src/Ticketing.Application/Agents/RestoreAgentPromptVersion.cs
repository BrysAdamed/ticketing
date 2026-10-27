using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>
/// "Restore version n": the old version's mode and body become a new version (history is never rewritten). Owners for a
/// project slot, Admins for an instance slot (<c>ProjectKeyOrId</c> null); cookie session only.
/// </summary>
public static class RestoreAgentPromptVersion
{
    public sealed record Command : IValidatable
    {
        [JsonIgnore]
        public string? ProjectKeyOrId { get; init; }

        [JsonIgnore]
        public string Slot { get; init; } = string.Empty;

        [JsonIgnore]
        public int Number { get; init; }

        public string? ChangeNote { get; init; }

        public int BaseVersion { get; init; }

        public void Validate(Validator validator) => validator
            .MaxLength("changeNote", ChangeNote, AgentPromptTemplate.ChangeNoteMaxLength)
            .Range("baseVersion", BaseVersion, 0, int.MaxValue);
    }

    public sealed class Handler(
        ITicketingDbContext db, AgentPromptAccess agents, AgentPromptComposer composer, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, AgentPromptVersionDto>
    {
        public async Task<AgentPromptVersionDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await agents.WriteAsync(command.ProjectKeyOrId, command.Slot, cancellationToken);
            command.EnsureValid();
            var instance = await AgentPromptQueries.InstanceAsync(db, cancellationToken);

            var template = await AgentPromptQueries.For(db, target).SingleOrDefaultAsync(cancellationToken)
                ?? throw GetAgentPromptVersion.VersionNotFound(target, command.Number);
            var source = await db.AgentPromptTemplateVersions
                .AsNoTracking()
                .SingleOrDefaultAsync(v => v.TemplateId == template.Id && v.Number == command.Number, cancellationToken)
                ?? throw GetAgentPromptVersion.VersionNotFound(target, command.Number);
            template.EnsureBaseVersion(command.BaseVersion);

            var (previousVersion, previousMode) = (template.CurrentVersion, template.Mode);
            var defaultVersion = target.Project is null ? (int?)null : instance[target.Slot].CurrentVersion;
            var version = template.Restore(source, command.ChangeNote, defaultVersion, currentUser.Id, clock.Now);
            if (target.Project is null)
                AgentPromptWrites.EnsureInstanceFits(composer, template, instance);
            else
                await AgentPromptWrites.EnsureProjectFitsAsync(db, composer, template, instance[AgentPromptSlot.Guardrails], cancellationToken);
            db.AgentPromptTemplateVersions.Add(version);
            AgentPromptWrites.RecordUpdated(activity, template, previousVersion, previousMode);
            await AgentPromptWrites.SaveAsync(db, cancellationToken);

            var author = await AgentPromptQueries.UsersAsync(db, [version.AuthorId], cancellationToken);
            return new AgentPromptVersionDto(
                version.Number, version.Mode, version.Body, version.BuiltInVersion, version.ChangeNote, AgentPromptQueries.User(author, version.AuthorId),
                version.CreatedAt, version.RestoredFrom);
        }
    }
}
