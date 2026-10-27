namespace Ticketing.Application.FeatureFlags;

/// <summary>
/// Whether a whole feature is available to the current caller (its flag and any instance configuration it needs). Register
/// implementations as scoped services; MCP tools marked with <c>[FeatureGate]</c> are listed only while their gate is open.
/// </summary>
public interface IFeatureGate
{
    Task<bool> IsEnabledAsync(CancellationToken cancellationToken);
}
