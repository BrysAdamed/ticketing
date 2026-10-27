using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>
/// Changes a project's agent setup (spec 13.3): omitted fields stay unchanged, the result is validated as a whole (enabling
/// needs a repository URL), and every changed field writes a <c>project.field.changed</c> entry. Owners and Admins, web
/// session only (<c>auth.cookieSessionRequired</c> for a PAT), so an agent cannot widen its own project's merge policy.
/// </summary>
public static class UpdateProjectAgentSettings
{
    public const string ChangedAction = "project.field.changed";

    public sealed record Command
    {
        [JsonIgnore]
        public string ProjectKeyOrId { get; init; } = string.Empty;

        public Optional<bool> Enabled { get; init; }

        public Optional<string?> RepositoryUrl { get; init; }

        public Optional<string> DefaultBranch { get; init; }

        public Optional<AgentMergePolicy> MergePolicy { get; init; }

        public Optional<bool> AssignOnDelegate { get; init; }

        public Optional<bool> StartProgressOnDelegate { get; init; }

        [JsonIgnore]
        public uint? ExpectedVersion { get; init; }
    }

    public sealed class Handler(ITicketingDbContext db, AgentPromptAccess agents, IActivityLog activity) : IHandler<Command, ProjectAgentSettingsDto>
    {
        public async Task<ProjectAgentSettingsDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var grant = await agents.ConfigureProjectAsync(command.ProjectKeyOrId, cancellationToken);
            var project = await db.Projects.SingleAsync(p => p.Id == grant.ProjectId, cancellationToken);
            db.ExpectVersion(project, command.ExpectedVersion);

            var before = project.AgentDelegation;
            project.ConfigureAgentDelegation(new AgentDelegationSettings(
                command.Enabled.GetValueOrDefault(before.Enabled),
                command.RepositoryUrl.GetValueOrDefault(before.RepositoryUrl),
                command.DefaultBranch.GetValueOrDefault(before.DefaultBranch),
                command.MergePolicy.GetValueOrDefault(before.MergePolicy),
                command.AssignOnDelegate.GetValueOrDefault(before.AssignOnDelegate),
                command.StartProgressOnDelegate.GetValueOrDefault(before.StartProgressOnDelegate)));
            var after = project.AgentDelegation;

            Record(project.Id, "agentDelegationEnabled", before.Enabled, after.Enabled);
            Record(project.Id, "repositoryUrl", before.RepositoryUrl, after.RepositoryUrl);
            Record(project.Id, "defaultBranch", before.DefaultBranch, after.DefaultBranch);
            Record(project.Id, "agentMergePolicy", before.MergePolicy, after.MergePolicy);
            Record(project.Id, "agentAssignOnDelegate", before.AssignOnDelegate, after.AssignOnDelegate);
            Record(project.Id, "agentStartProgressOnDelegate", before.StartProgressOnDelegate, after.StartProgressOnDelegate);

            await db.SaveChangesAsync(cancellationToken);
            return ProjectAgentSettingsDto.From(after, project.RowVersion);
        }

        private void Record<T>(Guid projectId, string field, T oldValue, T newValue) =>
            activity.RecordChange(ActivityEntityType.Project, projectId, projectId, ChangedAction, field, oldValue, newValue);
    }
}
