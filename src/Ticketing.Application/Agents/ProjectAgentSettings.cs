using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>
/// A project's agent setup (spec 13.3). <see cref="NormalizedRepositoryUrl"/> is the form clones are compared by
/// (<c>git.example.com/team/repo</c>), null without a URL. <see cref="RowVersion"/> is the project's; send it as
/// <c>If-Match</c> when changing the setup.
/// </summary>
public sealed record ProjectAgentSettingsDto(
    bool Enabled,
    string? RepositoryUrl,
    string? NormalizedRepositoryUrl,
    string DefaultBranch,
    AgentMergePolicy MergePolicy,
    bool AssignOnDelegate,
    bool StartProgressOnDelegate,
    uint RowVersion)
{
    public static ProjectAgentSettingsDto From(AgentDelegationSettings settings, uint rowVersion) => new(
        settings.Enabled,
        settings.RepositoryUrl,
        GitRemoteUrl.TryParse(settings.RepositoryUrl, out var url) ? url.Key : null,
        settings.DefaultBranch,
        settings.MergePolicy,
        settings.AssignOnDelegate,
        settings.StartProgressOnDelegate,
        rowVersion);

    internal static async Task<ProjectAgentSettingsDto> LoadAsync(ITicketingDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        var row = await db.Projects
            .AsNoTracking()
            .Where(p => p.Id == projectId)
            .Select(p => new
            {
                Settings = new AgentDelegationSettings(
                    p.AgentDelegationEnabled, p.RepositoryUrl, p.DefaultBranch, p.AgentMergePolicy, p.AgentAssignOnDelegate, p.AgentStartProgressOnDelegate),
                p.RowVersion,
            })
            .SingleAsync(cancellationToken);
        return From(row.Settings, row.RowVersion);
    }
}
