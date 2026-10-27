using Microsoft.Extensions.Options;
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

    /// <summary>Unset, or an absolute http(s) URL without query or fragment; checked at startup.</summary>
    public bool IsValid =>
        InstanceUrl is not { } url
        || (Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) && uri.Query.Length == 0 && uri.Fragment.Length == 0);
}

/// <summary>
/// The single check every agent entry point starts with: while <see cref="AgentFeature.FlagKey"/> is off for the caller, or
/// the instance has no <see cref="AgentOptions.PublicUrlVariable"/> to build ticket links from, everything about agents is a
/// 404 <c>agent.disabled</c>, so the feature is neither visible nor callable.
/// </summary>
public sealed class AgentGate(IFeatureFlags flags, IOptions<AgentOptions> options) : IFeatureGate
{
    public bool IsConfigured => options.Value.InstanceUrl is not null;

    public async Task<bool> IsEnabledAsync(CancellationToken cancellationToken) =>
        IsConfigured && await flags.IsOnAsync(AgentFeature.FlagKey, cancellationToken);

    public async Task EnsureEnabledAsync(CancellationToken cancellationToken)
    {
        if (!await flags.IsOnAsync(AgentFeature.FlagKey, cancellationToken))
            throw AppException.NotFound(AgentErrors.Disabled, "Agent delegation is not available.");
        if (!IsConfigured)
            throw AppException.NotFound(AgentErrors.Disabled, $"Agent delegation is not available: this instance has no {AgentOptions.PublicUrlVariable}.");
    }
}
