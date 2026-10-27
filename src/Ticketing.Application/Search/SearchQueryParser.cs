using System.Globalization;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Search;

/// <summary>
/// Parses the search query string of <c>docs/architecture/search-url-format.md</c> into <see cref="TicketSearchCriteria"/>.
/// Lists are comma-separated and/or repeated; every invalid value is reported at once as a 400 <c>validation</c> error
/// keyed by the parameter name.
/// </summary>
public static class SearchQueryParser
{
    public const string None = "none";
    public const string Unassigned = "unassigned";
    public const string Me = "me";
    public const int MaxListValues = 100;

    public static TicketSearchCriteria Parse(IReadOnlyDictionary<string, IReadOnlyList<string?>> query)
    {
        var v = new Validator();
        var parameters = new Parameters(query);

        var severityTokens = parameters.List("severity");
        var version = parameters.Single("version");
        var criteria = new TicketSearchCriteria
        {
            ProjectKeys = [.. parameters.List("project").Select(k => k.ToUpperInvariant()).Distinct()],
            Text = parameters.Single("q"),
            Types = Enums<TicketType>(v, "type", parameters.List("type")),
            Statuses = Enums<TicketStatus>(v, "status", parameters.List("status")),
            Categories = Enums<StatusCategory>(v, "category", parameters.List("category")),
            Priorities = Enums<Priority>(v, "priority", parameters.List("priority")),
            Severities = Enums<Severity>(v, "severity", [.. severityTokens.Where(s => !IsToken(s, None))]),
            SeverityNone = severityTokens.Any(s => IsToken(s, None)),
            Assignees = Users(v, "assignee", parameters.List("assignee"), allowUnassigned: true),
            ExcludedAssignees = Users(v, "assigneeNot", parameters.List("assigneeNot"), allowUnassigned: true),
            Reporters = Users(v, "reporter", parameters.List("reporter"), allowUnassigned: false),
            Labels = [.. parameters.List("label").Select(l => l.ToLowerInvariant()).Distinct()],
            Version = version is not null && !IsToken(version, None) ? version : null,
            VersionNone = version is not null && IsToken(version, None),
            Parent = Parent(v, parameters.Single("parent")),
            Location = Location(v, parameters.Single("location")),
            Created = Range(v, "created", parameters.Single("createdFrom"), parameters.Single("createdTo")),
            Updated = Range(v, "updated", parameters.Single("updatedFrom"), parameters.Single("updatedTo")),
            Resolved = Range(v, "resolved", parameters.Single("resolvedFrom"), parameters.Single("resolvedTo")),
            FromRegression = Flag(v, "fromRegression", parameters.Single("fromRegression")),
            Watching = Flag(v, "watching", parameters.Single("watching")),
            Sort = Sort(v, parameters.Single("sort")),
            Order = Order(v, parameters.Single("order")),
        };

        v.MaxLength("q", criteria.Text, SqlLike.MaxTextLength);
        foreach (var (name, count) in parameters.ListCounts)
            v.Must(count <= MaxListValues, name, $"{name} accepts at most {MaxListValues} values.");
        v.ThrowIfInvalid();
        return criteria;
    }

    /// <summary>A plain date covers the whole UTC day; a timestamp is used as-is (From inclusive, To exclusive).</summary>
    public static DateTimeOffset? ParseBound(string? value, bool isUpper)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        var text = value.Trim();
        if (DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            var start = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            return isUpper ? start.AddDays(1) : start;
        }
        if (DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var instant)
            && text.Contains('T', StringComparison.Ordinal))
            return instant.ToUniversalTime();
        throw new FormatException();
    }

    private static bool IsToken(string value, string token) => string.Equals(value, token, StringComparison.OrdinalIgnoreCase);

    private static List<T> Enums<T>(Validator v, string name, IReadOnlyList<string> values)
        where T : struct, Enum
    {
        var result = new List<T>();
        foreach (var value in values)
        {
            if (Enum.TryParse<T>(value, ignoreCase: true, out var parsed) && Enum.IsDefined(parsed) && !int.TryParse(value, out _))
            {
                if (!result.Contains(parsed))
                    result.Add(parsed);
            }
            else
            {
                v.Add(name, $"'{value}' is not a valid {name}. Allowed: {string.Join(", ", Enum.GetNames<T>())}.");
            }
        }
        return result;
    }

    private static List<string> Users(Validator v, string name, IReadOnlyList<string> values, bool allowUnassigned)
    {
        var result = new List<string>();
        foreach (var value in values)
        {
            var normalized = IsToken(value, Me) ? Me
                : allowUnassigned && IsToken(value, Unassigned) ? Unassigned
                : Guid.TryParse(value, out var id) ? id.ToString()
                : value.Contains('@', StringComparison.Ordinal) ? value.ToLowerInvariant()
                : null;
            if (normalized is null)
                v.Add(name, $"'{value}' is not a user id, an email{(allowUnassigned ? ", 'unassigned'" : string.Empty)} or 'me'.");
            else if (!result.Contains(normalized))
                result.Add(normalized);
        }
        return result;
    }

    private static string? Parent(Validator v, string? value)
    {
        if (value is null)
            return null;
        if (Guid.TryParse(value, out var id))
            return id.ToString();
        if (HumanKeys.TryParseTicket(value, out var projectKey, out var number))
            return HumanKeys.Ticket(projectKey, number);
        v.Add("parent", $"'{value}' is not a ticket key or id.");
        return null;
    }

    private static SearchLocation? Location(Validator v, string? value)
    {
        if (value is null)
            return null;
        if (IsToken(value, "backlog"))
            return SearchLocation.Backlog;
        if (IsToken(value, "board"))
            return SearchLocation.AnyBoard;
        if (Guid.TryParse(value, out var boardId))
            return new SearchLocation(SearchLocationKind.Board, boardId);
        v.Add("location", "location must be backlog, board or a board id.");
        return null;
    }

    private static DateRange Range(Validator v, string name, string? from, string? to)
    {
        var lower = Bound(v, name + "From", from, isUpper: false);
        var upper = Bound(v, name + "To", to, isUpper: true);
        if (lower is null && upper is null)
            return DateRange.Any;
        v.Must(lower is null || upper is null || lower < upper, name + "To", $"{name}To must be after {name}From.");
        return new DateRange(lower, upper);
    }

    private static DateTimeOffset? Bound(Validator v, string name, string? value, bool isUpper)
    {
        try
        {
            return ParseBound(value, isUpper);
        }
        catch (FormatException)
        {
            v.Add(name, $"{name} must be a date (2026-10-01) or a UTC timestamp (2026-10-01T12:00:00Z).");
            return null;
        }
    }

    private static bool Flag(Validator v, string name, string? value)
    {
        if (value is null)
            return false;
        if (bool.TryParse(value, out var flag))
            return flag;
        v.Add(name, $"{name} must be true or false.");
        return false;
    }

    private static TicketSort Sort(Validator v, string? value)
    {
        if (value is null)
            return TicketSort.Updated;
        if (Enum.TryParse<TicketSort>(value, ignoreCase: true, out var sort) && Enum.IsDefined(sort) && !int.TryParse(value, out _))
            return sort;
        v.Add("sort", "sort must be updated, created, priority, key or rank.");
        return TicketSort.Updated;
    }

    private static SortOrder? Order(Validator v, string? value)
    {
        if (value is null)
            return null;
        if (IsToken(value, "asc"))
            return SortOrder.Asc;
        if (IsToken(value, "desc"))
            return SortOrder.Desc;
        v.Add("order", "order must be asc or desc.");
        return null;
    }

    private sealed class Parameters(IReadOnlyDictionary<string, IReadOnlyList<string?>> query)
    {
        public Dictionary<string, int> ListCounts { get; } = new(StringComparer.Ordinal);

        public string? Single(string name)
        {
            if (!query.TryGetValue(name, out var values))
                return null;
            var value = values.LastOrDefault(s => !string.IsNullOrWhiteSpace(s));
            return value?.Trim();
        }

        public IReadOnlyList<string> List(string name)
        {
            if (!query.TryGetValue(name, out var values))
                return [];
            var items = values
                .Where(s => s is not null)
                .SelectMany(s => s!.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                .ToList();
            ListCounts[name] = items.Count;
            return items;
        }
    }
}
