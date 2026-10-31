using Ticketing.Application.Abstractions;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Users;

namespace Ticketing.Application.FeatureFlags;

/// <summary>A user a flag is evaluated for outside their own request, for example by a background job.</summary>
public sealed record FlagSubject(Guid UserId, GlobalRole Role);

/// <summary>
/// Evaluates the declared feature flags (spec 6.13, D-169). A flag that is not declared, or retired, is <c>off</c>; a declared
/// flag without a row yet evaluates to its default. Use <see cref="IsOnAsync"/> to gate server-side behaviour.
/// </summary>
public interface IFeatureFlags
{
    /// <summary>The variant of every declared flag for the current user; retired rows are left out.</summary>
    Task<IReadOnlyDictionary<string, string>> EvaluateAllAsync(CancellationToken cancellationToken);

    Task<string> VariantAsync(FeatureFlagDefinition flag, CancellationToken cancellationToken);

    Task<bool> IsOnAsync(FeatureFlagDefinition flag, CancellationToken cancellationToken);

    /// <summary>
    /// Evaluates <paramref name="flag"/> for many users with the same rules as <see cref="IsOnAsync"/>, without a request user
    /// and without a query per user. Returns the ids of the users the flag is on for.
    /// </summary>
    Task<IReadOnlySet<Guid>> EvaluateForAsync(FeatureFlagDefinition flag, IReadOnlyCollection<FlagSubject> users, CancellationToken cancellationToken);
}

internal sealed class FeatureFlagEvaluator(IFeatureFlagStore store, IFeatureFlagCatalog catalog, ICurrentUser currentUser) : IFeatureFlags
{
    public async Task<IReadOnlyDictionary<string, string>> EvaluateAllAsync(CancellationToken cancellationToken)
    {
        var rows = await RowsAsync(cancellationToken);
        return catalog.Definitions.ToDictionary(d => d.Key, d => ForCurrentUser(d, rows), StringComparer.Ordinal);
    }

    public async Task<string> VariantAsync(FeatureFlagDefinition flag, CancellationToken cancellationToken) =>
        ForCurrentUser(flag, await RowsAsync(cancellationToken));

    public async Task<bool> IsOnAsync(FeatureFlagDefinition flag, CancellationToken cancellationToken) =>
        await VariantAsync(flag, cancellationToken) == FlagVariants.On;

    public async Task<IReadOnlySet<Guid>> EvaluateForAsync(
        FeatureFlagDefinition flag, IReadOnlyCollection<FlagSubject> users, CancellationToken cancellationToken)
    {
        var rows = await RowsAsync(cancellationToken);
        return users.Where(u => Evaluate(flag, rows, u.UserId, u.Role) == FlagVariants.On).Select(u => u.UserId).ToHashSet();
    }

    private async Task<Dictionary<string, FeatureFlag>> RowsAsync(CancellationToken cancellationToken) =>
        (await store.GetAllAsync(cancellationToken)).ToDictionary(f => f.Key, StringComparer.Ordinal);

    private string ForCurrentUser(FeatureFlagDefinition flag, Dictionary<string, FeatureFlag> rows) =>
        currentUser.IsAuthenticated ? Evaluate(flag, rows, currentUser.Id, currentUser.Role) : FlagVariants.Off;

    private string Evaluate(FeatureFlagDefinition flag, Dictionary<string, FeatureFlag> rows, Guid userId, GlobalRole role)
    {
        if (catalog.Find(flag.Key) is not { } declared)
            return FlagVariants.Off;
        if (rows.TryGetValue(declared.Key, out var row))
            return row.Evaluate(userId, role);
        return declared.DefaultOn ? FlagVariants.On : FlagVariants.Off;
    }
}
