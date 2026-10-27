using Ticketing.Application.Search;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// The docs search filters of refinement 1.10, shared by <c>GET /docs/search</c>, the <c>search_docs</c> MCP tool and the
/// command palette. The URL encoding (<c>docs/architecture/search-url-format.md</c>, "Docs search") is parsed by
/// <see cref="DocSearchQueryParser"/>. References (projects, folder, ticket) are resolved per caller, so unreadable ones match nothing.
/// </summary>
public sealed record DocSearchCriteria
{
    public IReadOnlyList<string> ProjectKeys { get; init; } = [];

    public string? Text { get; init; }

    public IReadOnlyList<DocKind> Kinds { get; init; } = [];

    /// <summary>A folder key or id: only docs anywhere below it.</summary>
    public string? Folder { get; init; }

    /// <summary>A ticket key or id: only docs whose latest content mentions it.</summary>
    public string? Mentions { get; init; }

    public DateRange Updated { get; init; } = DateRange.Any;

    /// <summary>Null means relevance when there is text, otherwise updated.</summary>
    public DocSearchSort? Sort { get; init; }

    public bool HasText => !string.IsNullOrWhiteSpace(Text);

    /// <summary>Relevance needs text; without it every search is sorted by updated.</summary>
    public DocSearchSort EffectiveSort => HasText ? Sort ?? DocSearchSort.Relevance : DocSearchSort.Updated;
}

public enum DocSearchSort
{
    /// <summary>Best match first (title weighs more than content); at most 100 results, no cursor.</summary>
    Relevance = 1,

    /// <summary>Latest update first, paged with a keyset cursor.</summary>
    Updated = 2,
}
