using Ticketing.Application.Abstractions;
using Ticketing.Application.FeatureFlags;

namespace Ticketing.Application.Me;

public static class GetMyFlags
{
    public sealed record Query;

    /// <summary>Variant per flag key (<c>on</c> or <c>off</c> in v1); a string so A/B variants can be added later.</summary>
    public sealed record Result(IReadOnlyDictionary<string, string> Flags);

    public sealed class Handler(IFeatureFlags flags) : IHandler<Query, Result>
    {
        public async Task<Result> HandleAsync(Query request, CancellationToken cancellationToken) =>
            new(await flags.EvaluateAllAsync(cancellationToken));
    }
}
