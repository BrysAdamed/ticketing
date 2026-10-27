using Ticketing.Application.Common;
using Ticketing.Application.FeatureFlags;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>The feature flag of agent delegation (spec 13.2): a string-variant flag, <c>on</c> or <c>off</c>, that Admins target.</summary>
public static class AgentFeature
{
    public const string FlagKey = "agent.delegate";
}

/// <summary>Instance configuration for agent delegation.</summary>
public sealed class AgentOptions
{
    /// <summary>The environment variable holding this instance's public origin, for example <c>http://localhost:8090</c>.</summary>
    public const string PublicUrlVariable = "TICKETING_PUBLIC_URL";

    public string? PublicUrl { get; set; }

    /// <summary>The configured public URL without a trailing slash; null when unset.</summary>
    public string? InstanceUrl => string.IsNullOrWhiteSpace(PublicUrl) ? null : PublicUrl.Trim().TrimEnd('/');
}

/// <summary>
/// The single check every agent entry point starts with: while <see cref="AgentFeature.FlagKey"/> is off for the caller,
/// everything about agents is a 404 <c>agent.disabled</c>, so the feature is neither visible nor callable.
/// </summary>
public sealed class AgentGate(IFeatureFlags flags)
{
    public Task<bool> IsEnabledAsync(CancellationToken cancellationToken) => flags.IsOnAsync(AgentFeature.FlagKey, cancellationToken);

    public async Task EnsureEnabledAsync(CancellationToken cancellationToken)
    {
        if (!await IsEnabledAsync(cancellationToken))
            throw AppException.NotFound(AgentErrors.Disabled, "Agent delegation is not available.");
    }
}
