using System.Net;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Search;

[Collection(nameof(SearchCollection))]
public sealed class SearchEndpointTests(TicketingApiFactory api)
{
    [Fact]
    public async Task Structured_filters_narrow_the_result()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var other = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", me, ProjectVisibility.Private, (other, ProjectRole.Member));
        var api2 = await api.SeedProjectAsync("API", me);
        var board = await api.CreateBoardAsync(me.Id, web);
        var ids = await api.SeedTicketsAsync(web, me.Id,
            new SeedTicket("Epic one", TicketType.Epic) { Labels = ["ui", "web"], Version = "1.0" },
            new SeedTicket("Crash on save", TicketType.Bug) { Severity = Severity.Critical, Priority = Priority.Highest, AssigneeId = me.Id, Status = TicketStatus.InProgress },
            new SeedTicket("Typo", TicketType.Bug) { AssigneeId = other.Id, ReporterId = other.Id, Labels = ["ui"], Status = TicketStatus.Done },
            new SeedTicket("On the board") { BoardId = board, Status = TicketStatus.Review },
            new SeedTicket("Deleted") { Deleted = true });
        await api.SeedTicketsAsync(web, me.Id, new SeedTicket("Child story") { ParentId = ids[0] });
        await api.SeedTicketsAsync(api2, me.Id, new SeedTicket("Api story") { Version = "1.0" });
        var client = await api.LoginAsync(me);

        // Act
        var all = await client.SearchKeysAsync("sort=key");
        var byProject = await client.SearchKeysAsync("project=api");
        var bugs = await client.SearchKeysAsync("type=Bug&sort=key");
        var open = await client.SearchKeysAsync("category=ToDo,InProgress&project=WEB&sort=key");
        var statusAndCategory = await client.SearchKeysAsync("status=Review&status=Done&category=Done");
        var critical = await client.SearchKeysAsync("severity=Critical");
        var noSeverityBugs = await client.SearchKeysAsync("type=Bug&severity=none");
        var mine = await client.SearchKeysAsync("assignee=me");
        var unassignedOrOther = await client.SearchKeysAsync($"assignee=unassigned,{other.Email.ToUpperInvariant()}&project=WEB&sort=key");
        var notMineNorUnassigned = await client.SearchKeysAsync("assigneeNot=me,unassigned");
        var reportedByOther = await client.SearchKeysAsync($"reporter={other.Id}");
        var allLabels = await client.SearchKeysAsync("label=UI,web");
        var anyLabel = await client.SearchKeysAsync("label=ui&sort=key");
        var version = await client.SearchKeysAsync("version=1.0&sort=key");
        var noVersion = await client.SearchKeysAsync("version=none&project=API");
        var children = await client.SearchKeysAsync("parent=web-1");
        var onBoard = await client.SearchKeysAsync("location=board");
        var onThatBoard = await client.SearchKeysAsync($"location={board}");
        var backlogCount = (await client.SearchAsync("location=backlog")).Total;
        var priority = await client.SearchKeysAsync("priority=Highest");

        // Assert
        Assert.Equal(["API-1", "WEB-1", "WEB-2", "WEB-3", "WEB-4", "WEB-6"], all);
        Assert.Equal(["API-1"], byProject);
        Assert.Equal(["WEB-2", "WEB-3"], bugs);
        Assert.Equal(["WEB-1", "WEB-2", "WEB-4", "WEB-6"], open);
        Assert.Equal(["WEB-3"], statusAndCategory);
        Assert.Equal(["WEB-2"], critical);
        Assert.Equal(["WEB-3"], noSeverityBugs);
        Assert.Equal(["WEB-2"], mine);
        Assert.Equal(["WEB-1", "WEB-3", "WEB-4", "WEB-6"], unassignedOrOther);
        Assert.Equal(["WEB-3"], notMineNorUnassigned);
        Assert.Equal(["WEB-3"], reportedByOther);
        Assert.Equal(["WEB-1"], allLabels);
        Assert.Equal(["WEB-1", "WEB-3"], anyLabel);
        Assert.Equal(["API-1", "WEB-1"], version);
        Assert.Empty(noVersion);
        Assert.Equal(["WEB-6"], children);
        Assert.Equal(["WEB-4"], onBoard);
        Assert.Equal(["WEB-4"], onThatBoard);
        Assert.Equal(5, backlogCount);
        Assert.Equal(["WEB-2"], priority);
    }

    [Fact]
    public async Task Date_ranges_accept_whole_days_and_timestamps()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", me);
        var day = new DateTimeOffset(2026, 10, 20, 0, 0, 0, TimeSpan.Zero);
        await api.SeedTicketsAsync(web, me.Id,
            new SeedTicket("Old") { CreatedAt = day.AddDays(-1).AddHours(23), UpdatedAt = day.AddDays(-1).AddHours(23) },
            new SeedTicket("Monday") { CreatedAt = day.AddHours(1), UpdatedAt = day.AddDays(5) },
            new SeedTicket("Monday night") { CreatedAt = day.AddHours(23).AddMinutes(59), UpdatedAt = day.AddDays(1) },
            new SeedTicket("Done") { CreatedAt = day.AddDays(1), UpdatedAt = day.AddDays(1), Status = TicketStatus.Done });
        var client = await api.LoginAsync(me);

        // Act
        var createdThatDay = await client.SearchKeysAsync("createdFrom=2026-10-20&createdTo=2026-10-20&sort=key");
        var updatedBefore = await client.SearchKeysAsync("updatedTo=2026-10-21T00:00:00Z&sort=key");
        var resolvedSince = await client.SearchKeysAsync("resolvedFrom=2026-10-21&resolvedTo=2026-10-21");
        var invalid = await client.GetAsync("/api/v1/tickets/search?createdFrom=yesterday&createdTo=2026-01-01&updatedFrom=2026-02-01&updatedTo=2026-01-01", TestContext.Current.CancellationToken);

        // Assert
        Assert.Equal(["WEB-2", "WEB-3"], createdThatDay);
        Assert.Equal(["WEB-1"], updatedBefore);
        Assert.Equal(["WEB-4"], resolvedSince);
        var problem = await invalid.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.True(problem.GetProperty("errors").TryGetProperty("createdFrom", out _));
        Assert.True(problem.GetProperty("errors").TryGetProperty("updatedTo", out _));
    }

    [Fact]
    public async Task Text_search_uses_full_text_stemming_partial_titles_and_keys()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", me);
        await api.SeedTicketsAsync(web, me.Id,
            new SeedTicket("Login page") { Description = "Users see timeouts when the server restarts." },
            new SeedTicket("Checkout redesign"),
            new SeedTicket("Payment provider") { Description = "Switch the provider for card payments." });
        var client = await api.LoginAsync(me);

        // Act
        var stemmed = await client.SearchKeysAsync("q=timeout");
        var partial = await client.SearchKeysAsync("q=eckou");
        var websearch = await client.SearchKeysAsync("q=" + Uri.EscapeDataString("provider -card"));
        var phrase = await client.SearchKeysAsync("q=" + Uri.EscapeDataString("\"card payments\""));
        var byKey = await client.SearchKeysAsync("q=web-2");
        var nothing = await client.SearchKeysAsync("q=zebra");

        // Assert
        Assert.Equal(["WEB-1"], stemmed);
        Assert.Equal(["WEB-2"], partial);
        Assert.Empty(websearch);
        Assert.Equal(["WEB-3"], phrase);
        Assert.Equal(["WEB-2"], byKey);
        Assert.Empty(nothing);
    }

    [Theory]
    [InlineData("updated", null)]
    [InlineData("updated", "asc")]
    [InlineData("created", null)]
    [InlineData("priority", null)]
    [InlineData("priority", "desc")]
    [InlineData("key", null)]
    [InlineData("key", "desc")]
    [InlineData("rank", null)]
    public async Task Every_sort_pages_through_all_results_in_order_without_gaps(string sort, string? order)
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", me);
        var app = await api.SeedProjectAsync("APP", me);
        var now = DateTimeOffset.UtcNow;
        var priorities = Enum.GetValues<Priority>();
        await api.SeedTicketsAsync(web, me.Id, [.. Enumerable.Range(0, 14).Select(i => new SeedTicket($"Web {i}")
        {
            Priority = priorities[i % priorities.Length], CreatedAt = now.AddMinutes(-i), UpdatedAt = now.AddMinutes(-(i % 3)),
        })]);
        await api.SeedTicketsAsync(app, me.Id, [.. Enumerable.Range(0, 9).Select(i => new SeedTicket($"App {i}") { Priority = priorities[i % priorities.Length] })]);
        var client = await api.LoginAsync(me);
        var query = $"sort={sort}" + (order is null ? string.Empty : $"&order={order}");

        // Act
        var expected = (await client.SearchAsync(query + "&limit=100")).Items.Select(t => t.Key).ToList();
        var pages = new List<string>();
        string? cursor = null;
        do
        {
            var page = await client.SearchAsync(query + "&limit=5" + (cursor is null ? string.Empty : $"&cursor={cursor}"));
            pages.AddRange(page.Items.Select(t => t.Key));
            cursor = page.NextCursor;
        }
        while (cursor is not null);

        // Assert
        Assert.Equal(23, expected.Count);
        Assert.Equal(expected, pages);
        if (sort == "key")
            Assert.Equal(order == "desc" ? "WEB-14" : "APP-1", expected[0]);
        if (sort == "priority")
            Assert.Equal(order == "desc" ? Priority.Lowest : Priority.Highest, (await client.SearchAsync(query)).Items[0].Priority);
    }

    [Fact]
    public async Task Cursor_from_another_sort_and_bad_values_are_rejected()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", me);
        await api.SeedTicketsAsync(web, me.Id, new SeedTicket("One"), new SeedTicket("Two"));
        var client = await api.LoginAsync(me);
        var cursor = (await client.SearchAsync("limit=1")).NextCursor;

        // Act
        var otherSort = await client.GetAsync($"/api/v1/tickets/search?sort=key&cursor={cursor}", TestContext.Current.CancellationToken);
        var garbage = await client.GetAsync("/api/v1/tickets/search?cursor=bm9wZQ", TestContext.Current.CancellationToken);
        var badValues = await client.GetAsync("/api/v1/tickets/search?status=Doing&type=Bug,Story&sort=title&location=nowhere&assignee=bob", TestContext.Current.CancellationToken);

        // Assert
        await otherSort.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.Equal(HttpStatusCode.BadRequest, garbage.StatusCode);
        var problem = await badValues.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        var errors = problem.GetProperty("errors");
        Assert.All(["status", "type", "sort", "location", "assignee"], field => Assert.True(errors.TryGetProperty(field, out _), field));
    }

    [Fact]
    public async Task First_page_reports_total_and_regression_bugs_filter_counts_every_session()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", me);
        var ids = await api.SeedTicketsAsync(web, me.Id, new SeedTicket("Bug A", TicketType.Bug), new SeedTicket("Bug B", TicketType.Bug), new SeedTicket("Story"));
        await api.SeedRegressionAsync(web, "WEB", me, null, ids[0]);
        await api.SeedRegressionAsync(web, "WEB", me, null, ids[1], cancelled: true);
        var client = await api.LoginAsync(me);

        // Act
        var first = await client.SearchAsync("limit=1");
        var second = await client.SearchAsync($"limit=1&cursor={first.NextCursor}");
        var regressionBugs = await client.SearchKeysAsync("fromRegression=true&sort=key");

        // Assert
        Assert.Equal((3, false), (first.Total!.Value, first.TotalCapped));
        Assert.Null(second.Total);
        Assert.Equal(["WEB-1", "WEB-2"], regressionBugs);
    }
}
