using Ticketing.Application.Abstractions;
using Ticketing.Domain.FeatureFlags;

namespace Ticketing.Application.FeatureFlags;

/// <summary>Evaluates feature flags for the current user (spec 6.13). Use <see cref="IsOnAsync"/> to gate server-side behaviour.</summary>
public interface IFeatureFlags
{
    Task<IReadOnlyDictionary<string, string>> EvaluateAllAsync(CancellationToken cancellationToken);

    Task<string> VariantAsync(string flagKey, CancellationToken cancellationToken);

    Task<bool> IsOnAsync(string flagKey, CancellationToken cancellationToken);
}

internal sealed class FeatureFlagEvaluator(IFeatureFlagStore store, ICurrentUser currentUser) : IFeatureFlags
{
    public async Task<IReadOnlyDictionary<string, string>> EvaluateAllAsync(CancellationToken cancellationToken)
    {
        var flags = await store.GetAllAsync(cancellationToken);
        return flags.ToDictionary(f => f.Key, Evaluate, StringComparer.Ordinal);
    }

    public async Task<string> VariantAsync(string flagKey, CancellationToken cancellationToken)
    {
        var flags = await store.GetAllAsync(cancellationToken);
        var flag = flags.FirstOrDefault(f => string.Equals(f.Key, flagKey, StringComparison.Ordinal));
        return flag is null ? FlagVariants.Off : Evaluate(flag);
    }

    public async Task<bool> IsOnAsync(string flagKey, CancellationToken cancellationToken) =>
        await VariantAsync(flagKey, cancellationToken) == FlagVariants.On;

    private string Evaluate(FeatureFlag flag) =>
        currentUser.IsAuthenticated ? flag.Evaluate(currentUser.Id, currentUser.Role) : FlagVariants.Off;
}
