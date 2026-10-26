using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Backlog;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Tickets;

[Collection(nameof(TicketsCollection))]
public sealed class BacklogTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Backlog_lists_open_backlog_tickets_in_rank_order_with_users_parents_and_counts()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        var epic = await client.CreateTicketAsync("WEB", "Epic", "Epic");
        var story = await client.CreateTicketAsync("WEB", "Story", extra: new { parentKey = epic.Key, assignee = "me", labels = new[] { "ui" } });
        await client.CreateTicketAsync("WEB", "Finished", extra: new { status = "Done", parentKey = epic.Key });
        var onBoard = await client.CreateTicketAsync("WEB", "On a board");
        await api.PlaceOnBoardAsync(onBoard.Id, await api.CreateBoardAsync(owner.Id, project.Id));
        await (await client.PostAsJsonAsync($"/api/v1/tickets/{story.Key}/comments", new { body = "Hi" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var backlog = await (await client.GetAsync("/api/v1/projects/WEB/backlog", _ct)).ReadAsync<BacklogDto>();
        var withDone = await (await client.GetAsync("/api/v1/projects/WEB/backlog?showDone=true", _ct)).ReadAsync<BacklogDto>();

        // Assert
        Assert.Equal(["WEB-1", "WEB-2"], backlog.Items.Select(i => i.Key));
        Assert.Equal(["WEB-1", "WEB-2", "WEB-3"], withDone.Items.Select(i => i.Key));
        var epicRow = backlog.Items[0];
        Assert.Equal((2, 1), (epicRow.ChildCount, epicRow.ChildDoneCount));
        var storyRow = backlog.Items[1];
        Assert.Equal((1, owner.Id, epic.Id), (storyRow.CommentCount, storyRow.AssigneeId!.Value, storyRow.ParentId!.Value));
        Assert.Equal(owner.Id, Assert.Single(backlog.Users).Id);
        Assert.Equal(epic.Key, Assert.Single(backlog.Parents).Key);
        Assert.True(backlog.CanWrite);
        Assert.False(backlog.Truncated);
    }

    [Fact]
    public async Task Backlog_filters_by_type_status_assignee_label_and_text()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        await client.CreateProjectAsync("WEB");
        await client.CreateTicketAsync("WEB", "Login bug", "Bug", new { assignee = "me", labels = new[] { "auth", "ui" } });
        await client.CreateTicketAsync("WEB", "Signup story", "UserStory", new { labels = new[] { "auth" }, status = "Review" });
        await client.CreateTicketAsync("WEB", "Spike", "Spike");

        async Task<string[]> Keys(string query) =>
            [.. (await (await client.GetAsync($"/api/v1/projects/WEB/backlog?{query}", _ct)).ReadAsync<BacklogDto>()).Items.Select(i => i.Key)];

        // Act / Assert
        Assert.Equal(["WEB-1"], await Keys("type=Bug"));
        Assert.Equal(["WEB-1", "WEB-3"], await Keys("type=Bug&type=Spike"));
        Assert.Equal(["WEB-2"], await Keys("status=Review"));
        Assert.Equal(["WEB-1"], await Keys("assignee=me"));
        Assert.Equal(["WEB-2", "WEB-3"], await Keys("assignee=unassigned"));
        Assert.Equal(["WEB-1"], await Keys("label=auth&label=UI"));
        Assert.Equal(["WEB-2"], await Keys("text=signup"));
        Assert.Equal(["WEB-3"], await Keys("text=web-3"));
    }

    [Fact]
    public async Task Backlog_of_a_private_project_is_404_for_outsiders()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("SECRET");
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var backlog = await outsider.GetAsync("/api/v1/projects/SECRET/backlog", _ct);
        var hints = await outsider.GetAsync("/api/v1/projects/SECRET/hints/labels", _ct);

        // Assert
        await backlog.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        await hints.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
    }

    [Fact]
    public async Task Rank_moves_one_ticket_before_or_after_another()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        for (var i = 1; i <= 4; i++)
            await client.CreateTicketAsync("WEB", $"Ticket {i}");

        // Act
        await Rank(client, new { tickets = new[] { "WEB-4" }, beforeKey = "WEB-2" });
        var afterFirst = await OrderAsync(client);
        await Rank(client, new { tickets = new[] { "WEB-1" }, afterKey = "WEB-3" });
        var afterSecond = await OrderAsync(client);

        // Assert
        Assert.Equal(["WEB-1", "WEB-4", "WEB-2", "WEB-3"], afterFirst);
        Assert.Equal(["WEB-4", "WEB-2", "WEB-3", "WEB-1"], afterSecond);
    }

    [Fact]
    public async Task Rank_moves_a_multi_selection_as_a_block_to_the_top_or_bottom_in_the_given_order()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        for (var i = 1; i <= 5; i++)
            await client.CreateTicketAsync("WEB", $"Ticket {i}");

        // Act
        await Rank(client, new { tickets = new[] { "WEB-3", "WEB-5" }, position = "Top" });
        var top = await OrderAsync(client);
        await Rank(client, new { tickets = new[] { "WEB-1", "WEB-3" }, position = "Bottom" });
        var bottom = await OrderAsync(client);
        await Rank(client, new { tickets = new[] { "WEB-1", "WEB-2" }, beforeKey = "WEB-4" });
        var between = await OrderAsync(client);

        // Assert
        Assert.Equal(["WEB-3", "WEB-5", "WEB-1", "WEB-2", "WEB-4"], top);
        Assert.Equal(["WEB-5", "WEB-2", "WEB-4", "WEB-1", "WEB-3"], bottom);
        Assert.Equal(["WEB-5", "WEB-1", "WEB-2", "WEB-4", "WEB-3"], between);
    }

    [Fact]
    public async Task Rank_rejects_bad_requests_tickets_on_boards_and_viewers()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        await client.CreateTicketAsync("WEB", "One");
        var onBoard = await client.CreateTicketAsync("WEB", "Two");
        await api.PlaceOnBoardAsync(onBoard.Id, await api.CreateBoardAsync(owner.Id, project.Id));
        var viewerUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewerUser, ProjectRole.Viewer);
        var viewer = await api.LoginAsync(viewerUser);

        // Act
        var noAnchor = await client.PostAsJsonAsync("/api/v1/projects/WEB/backlog/rank", new { tickets = new[] { "WEB-1" } }, _ct);
        var selfAnchor = await client.PostAsJsonAsync("/api/v1/projects/WEB/backlog/rank", new { tickets = new[] { "WEB-1" }, beforeKey = "WEB-1" }, _ct);
        var boardTicket = await client.PostAsJsonAsync("/api/v1/projects/WEB/backlog/rank", new { tickets = new[] { "WEB-2" }, position = "Top" }, _ct);
        var boardAnchor = await client.PostAsJsonAsync("/api/v1/projects/WEB/backlog/rank", new { tickets = new[] { "WEB-1" }, afterKey = "WEB-2" }, _ct);
        var byViewer = await viewer.PostAsJsonAsync("/api/v1/projects/WEB/backlog/rank", new { tickets = new[] { "WEB-1" }, position = "Top" }, _ct);

        // Assert
        await noAnchor.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        await selfAnchor.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        await boardTicket.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.NotInBacklog);
        await boardAnchor.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.NotInBacklog);
        await byViewer.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
    }

    [Fact]
    public async Task Backlog_of_five_thousand_open_tickets_loads_in_one_lean_response()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("BIG");
        await api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var ranks = Domain.Ordering.FractionalIndex.NKeysBetween(null, null, 5000);
            for (var i = 0; i < ranks.Count; i++)
                db.Tickets.Add(Ticket.Create(project.Id, i + 1, $"Ticket {i + 1}", TicketType.UserStory, owner.Id, ranks[i], now));
            return await db.SaveChangesAsync(_ct);
        });
        await client.GetAsync("/api/v1/projects/BIG/backlog", _ct);

        // Act
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var backlog = await (await client.GetAsync("/api/v1/projects/BIG/backlog", _ct)).ReadAsync<BacklogDto>();
        watch.Stop();

        // Assert
        Assert.Equal(5000, backlog.Items.Count);
        Assert.Equal("BIG-1", backlog.Items[0].Key);
        Assert.True(watch.ElapsedMilliseconds < 2000, $"Backlog took {watch.ElapsedMilliseconds} ms");
    }

    [Fact]
    public async Task Field_hints_return_recent_labels_and_versions_including_regression_sessions()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        await client.CreateTicketAsync("WEB", "One", extra: new { labels = new[] { "backend", "api" }, version = "1.0.0" });
        await client.CreateTicketAsync("WEB", "Two", extra: new { labels = new[] { "frontend" }, version = "1.1.0" });
        await api.WithDbAsync(async db =>
        {
            var testCase = Domain.TestCases.TestCase.Create(project.Id, 1, "Smoke", owner.Id, DateTimeOffset.UtcNow);
            testCase.ChangeStatus(Domain.TestCases.TestCaseStatus.Automatic);
            db.TestCases.Add(testCase);
            db.RegressionSessions.Add(Domain.Regressions.RegressionSession.Start(
                project.Id, "WEB", 1, null, "2.0.0-rc", [testCase], owner.Id, DateTimeOffset.UtcNow.AddMinutes(5)));
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var labels = await (await client.GetAsync("/api/v1/projects/WEB/hints/labels", _ct)).ReadAsync<string[]>();
        var prefixed = await (await client.GetAsync("/api/v1/projects/WEB/hints/labels?prefix=B", _ct)).ReadAsync<string[]>();
        var versions = await (await client.GetAsync("/api/v1/projects/WEB/hints/Version", _ct)).ReadAsync<string[]>();
        var bad = await client.GetAsync("/api/v1/projects/WEB/hints/title", _ct);

        // Assert
        Assert.Equal(["frontend", "api", "backend"], labels);
        Assert.Equal(["backend"], prefixed);
        Assert.Equal(["2.0.0-rc", "1.1.0", "1.0.0"], versions);
        await bad.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
    }

    private async Task Rank(HttpClient client, object body) =>
        await (await client.PostAsJsonAsync("/api/v1/projects/WEB/backlog/rank", body, _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

    private async Task<List<string>> OrderAsync(HttpClient client) =>
        [.. (await (await client.GetAsync("/api/v1/projects/WEB/backlog", _ct)).ReadAsync<BacklogDto>()).Items.Select(i => i.Key)];
}
