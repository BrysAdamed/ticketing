using Ticketing.Application.Common;
using Ticketing.Application.Search;
using Ticketing.Domain.Tickets;

namespace Ticketing.IntegrationTests.Search;

/// <summary>Pure tests of the URL format (docs/architecture/search-url-format.md); no database.</summary>
public sealed class SearchQueryParserTests
{
    [Fact]
    public void Lists_merge_comma_separated_and_repeated_values_case_insensitively()
    {
        // Act
        var criteria = Parse(("project", "web,Api"), ("project", "WEB"), ("status", "inprogress,Review"), ("status", "review"),
            ("category", "ToDo"), ("label", "UI, Backend"), ("severity", "Major,none"), ("assignee", "ME,Unassigned,Jane@Example.com"));

        // Assert
        Assert.Equal(["WEB", "API"], criteria.ProjectKeys);
        Assert.Equal([TicketStatus.InProgress, TicketStatus.Review], criteria.Statuses);
        Assert.Equal([StatusCategory.ToDo], criteria.Categories);
        Assert.Equal(["ui", "backend"], criteria.Labels);
        Assert.Equal([Severity.Major], criteria.Severities);
        Assert.True(criteria.SeverityNone);
        Assert.Equal(["me", "unassigned", "jane@example.com"], criteria.Assignees);
    }

    [Fact]
    public void Plain_dates_cover_the_whole_utc_day_and_timestamps_are_exact()
    {
        // Act
        var criteria = Parse(("createdFrom", "2026-10-19"), ("createdTo", "2026-10-25"), ("updatedTo", "2026-10-01T12:30:00+02:00"));

        // Assert
        Assert.Equal(new DateTimeOffset(2026, 10, 19, 0, 0, 0, TimeSpan.Zero), criteria.Created.From);
        Assert.Equal(new DateTimeOffset(2026, 10, 26, 0, 0, 0, TimeSpan.Zero), criteria.Created.To);
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 10, 30, 0, TimeSpan.Zero), criteria.Updated.To);
        Assert.True(criteria.Resolved.IsAny);
    }

    [Theory]
    [InlineData(null, null, TicketSort.Updated, SortOrder.Desc)]
    [InlineData("created", null, TicketSort.Created, SortOrder.Desc)]
    [InlineData("priority", null, TicketSort.Priority, SortOrder.Asc)]
    [InlineData("KEY", "desc", TicketSort.Key, SortOrder.Desc)]
    [InlineData("rank", "ASC", TicketSort.Rank, SortOrder.Asc)]
    public void Sort_defaults_depend_on_the_field(string? sort, string? order, TicketSort expectedSort, SortOrder expectedOrder)
    {
        // Act
        var criteria = Parse(("sort", sort), ("order", order));

        // Assert
        Assert.Equal((expectedSort, expectedOrder), (criteria.Sort, criteria.EffectiveOrder));
    }

    [Fact]
    public void Special_tokens_parse_to_flags()
    {
        // Act
        var criteria = Parse(("version", "none"), ("location", "backlog"), ("parent", "web-12"), ("fromRegression", "true"), ("q", "  login  "), ("status", ""));

        // Assert
        Assert.True(criteria.VersionNone);
        Assert.Null(criteria.Version);
        Assert.Equal(SearchLocation.Backlog, criteria.Location);
        Assert.Equal("WEB-12", criteria.Parent);
        Assert.True(criteria.FromRegression);
        Assert.Equal("login", criteria.Text);
        Assert.Empty(criteria.Statuses);
    }

    [Fact]
    public void Every_invalid_parameter_is_reported_at_once()
    {
        // Act
        var error = Assert.Throws<AppException>(() => Parse(
            ("type", "Story"), ("priority", "3"), ("reporter", "unassigned"), ("parent", "nope"), ("createdFrom", "2026-13-01"),
            ("resolvedFrom", "2026-10-02"), ("resolvedTo", "2026-10-01"), ("fromRegression", "yes"), ("order", "up")));

        // Assert
        Assert.Equal(AppErrors.Validation, error.Code);
        Assert.Equal(["createdFrom", "fromRegression", "order", "parent", "priority", "reporter", "resolvedTo", "type"], error.Errors.Keys.Order());
    }

    private static TicketSearchCriteria Parse(params (string Name, string? Value)[] parameters) =>
        SearchQueryParser.Parse(parameters
            .GroupBy(p => p.Name)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string?>)[.. g.Select(p => p.Value)], StringComparer.Ordinal));
}
