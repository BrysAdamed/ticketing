using Microsoft.Extensions.Options;
using Ticketing.Application.Abstractions;

namespace Ticketing.Application.Agents;

/// <summary>
/// Whether this instance can delegate: <see cref="PublicUrl"/> is the configured <see cref="AgentOptions.PublicUrlVariable"/>
/// (null while unset, which keeps delegation off for everyone).
/// </summary>
public sealed record AgentInstanceStatusDto(string PublicUrlVariable, string? PublicUrl, bool DelegationAvailable);

/// <summary>
/// Admins in the web app: the instance's agent configuration for the Admin page. Reachable with the flag on even while the
/// public URL is unset, unlike every other agent endpoint (D-103); the URL is never shown to anyone else.
/// </summary>
public static class GetAgentInstanceStatus
{
    public sealed record Query;

    public sealed class Handler(AgentPromptAccess agents, IOptions<AgentOptions> options) : IHandler<Query, AgentInstanceStatusDto>
    {
        public async Task<AgentInstanceStatusDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            await agents.EnsureAdminStatusAsync(cancellationToken);
            var url = options.Value.InstanceUrl;
            return new AgentInstanceStatusDto(AgentOptions.PublicUrlVariable, url, url is not null);
        }
    }
}
