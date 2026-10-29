using Ticketing.Application.Abstractions;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Users;

namespace Ticketing.Application.FeatureFlags;

/// <summary>A user a flag is evaluated for outside their own request, for example by a background job.</summary>
public sealed record FlagSubject(Guid UserId, GlobalRole Role);

/// <summary>Evaluates feature flags for the current user (spec 6.13). Use <see cref="IsOnAsync"/> to gate server-side behaviour.</summary>
public interface IFeatureFlags
{
    Task<IReadOnlyDictionary<string, string>> EvaluateAllAsync(CancellationToken cancellationToken);

    Task<string> VariantAsync(string flagKey, CancellationToken cancellationToken);

    Task<bool> IsOnAsync(string flagKey, CancellationToken cancellationToken);

    /// <summary>
    /// Evaluates <paramref name="flagKey"/> for many users with the same rules as <see cref="IsOnAsync"/>, without a request user
    /// and without a query per user. Returns the ids of the users the flag is on for.
    /// </summary>
    Task<IReadOnlySet<Guid>> EvaluateForAsync(string flagKey, IReadOnlyCollection<FlagSubject> users, CancellationToken cancellationToken);
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
        var flag = await FindAsync(flagKey, cancellationToken);
        return flag is null ? FlagVariants.Off : Evaluate(flag);
    }

    public async Task<bool> IsOnAsync(string flagKey, CancellationToken cancellationToken) =>
        await VariantAsync(flagKey, cancellationToken) == FlagVariants.On;

    public async Task<IReadOnlySet<Guid>> EvaluateForAsync(
        string flagKey, IReadOnlyCollection<FlagSubject> users, CancellationToken cancellationToken)
    {
        var flag = await FindAsync(flagKey, cancellationToken);
        if (flag is null)
            return new HashSet<Guid>();
        return users.Where(u => flag.Evaluate(u.UserId, u.Role) == FlagVariants.On).Select(u => u.UserId).ToHashSet();
    }

    private async Task<FeatureFlag?> FindAsync(string flagKey, CancellationToken cancellationToken)
    {
        var flags = await store.GetAllAsync(cancellationToken);
        return flags.FirstOrDefault(f => string.Equals(f.Key, flagKey, StringComparison.Ordinal));
    }

    private string Evaluate(FeatureFlag flag) =>
        currentUser.IsAuthenticated ? flag.Evaluate(currentUser.Id, currentUser.Role) : FlagVariants.Off;
}
