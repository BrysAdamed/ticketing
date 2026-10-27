using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Search;

/// <summary>
/// The ticket search filters of spec 6.8, shared by REST search, CSV export and the <c>search_tickets</c> MCP tool.
/// The URL encoding is <c>docs/architecture/search-url-format.md</c> (parsed by <see cref="SearchQueryParser"/>).
/// References (projects, users, parent, board) stay as given and are resolved per caller, so unreadable ones match nothing.
/// </summary>
public sealed record TicketSearchCriteria
{
    public IReadOnlyList<string> ProjectKeys { get; init; } = [];

    public string? Text { get; init; }

    public IReadOnlyList<TicketType> Types { get; init; } = [];

    public IReadOnlyList<TicketStatus> Statuses { get; init; } = [];

    public IReadOnlyList<StatusCategory> Categories { get; init; } = [];

    public IReadOnlyList<Priority> Priorities { get; init; } = [];

    public IReadOnlyList<Severity> Severities { get; init; } = [];

    /// <summary>Also match tickets without a severity (<c>severity=none</c>).</summary>
    public bool SeverityNone { get; init; }

    /// <summary><c>me</c>, <c>unassigned</c>, a user id or an email.</summary>
    public IReadOnlyList<string> Assignees { get; init; } = [];

    public IReadOnlyList<string> ExcludedAssignees { get; init; } = [];

    public IReadOnlyList<string> Reporters { get; init; } = [];

    /// <summary>All of these labels (lower-cased).</summary>
    public IReadOnlyList<string> Labels { get; init; } = [];

    /// <summary>Exact version; <see cref="VersionNone"/> for "no version".</summary>
    public string? Version { get; init; }

    public bool VersionNone { get; init; }

    public string? Parent { get; init; }

    public SearchLocation? Location { get; init; }

    public DateRange Created { get; init; } = DateRange.Any;

    public DateRange Updated { get; init; } = DateRange.Any;

    public DateRange Resolved { get; init; } = DateRange.Any;

    public bool FromRegression { get; init; }

    /// <summary>Only tickets the caller watches.</summary>
    public bool Watching { get; init; }

    public TicketSort Sort { get; init; } = TicketSort.Updated;

    /// <summary>Null means the sort's default direction.</summary>
    public SortOrder? Order { get; init; }

    public SortOrder EffectiveOrder => Order ?? (Sort is TicketSort.Updated or TicketSort.Created ? SortOrder.Desc : SortOrder.Asc);
}

public enum TicketSort
{
    Updated = 1,
    Created = 2,
    Priority = 3,
    Key = 4,
    Rank = 5,
}

public enum SortOrder
{
    Asc = 1,
    Desc = 2,
}

public enum SearchLocationKind
{
    Backlog = 1,
    AnyBoard = 2,
    Board = 3,
}

public sealed record SearchLocation(SearchLocationKind Kind, Guid? BoardId = null)
{
    public static readonly SearchLocation Backlog = new(SearchLocationKind.Backlog);
    public static readonly SearchLocation AnyBoard = new(SearchLocationKind.AnyBoard);
}

/// <summary>A half-open UTC range: <see cref="From"/> inclusive, <see cref="To"/> exclusive; either end may be open.</summary>
public sealed record DateRange(DateTimeOffset? From, DateTimeOffset? To)
{
    public static readonly DateRange Any = new(null, null);

    public bool IsAny => From is null && To is null;
}
