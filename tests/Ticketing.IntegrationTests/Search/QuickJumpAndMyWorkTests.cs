using Ticketing.Application.Search;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Search;

[Collection(nameof(SearchCollection))]
public sealed class QuickJumpAndMyWorkTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Quick_jump_puts_exact_keys_first_then_at_most_ten_titles()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", me);
        await api.SeedTicketsAsync(web, me.Id, [.. Enumerable.Range(1, 12).Select(i => new SeedTicket($"Login flow step {i}"))]);
        await api.SeedTicketsAsync(web, me.Id, new SeedTicket("Gone login") { Deleted = true });
        await api.SeedRegressionAsync(web, "WEB", me, me.Id);
        var client = await api.LoginAsync(me);

        // Act
        var byKey = await JumpAsync(client, "web-3");
        var byTestCase = await JumpAsync(client, "WEB-tc-1");
        var bySession = await JumpAsync(client, "web-r-1");
        var byTitle = await JumpAsync(client, "login");
        var unknownKey = await JumpAsync(client, "WEB-999");
        var blank = await JumpAsync(client, "  ");

        // Assert
        Assert.Equal((QuickJumpKind.Ticket, "WEB-3", "/tickets/WEB-3"), (byKey[0].Kind, byKey[0].Key, byKey[0].Url));
        Assert.Equal((QuickJumpKind.TestCase, "WEB-TC-1", "/projects/WEB/test-cases/WEB-TC-1"), (byTestCase[0].Kind, byTestCase[0].Key, byTestCase[0].Url));
        Assert.Equal((QuickJumpKind.RegressionSession, "WEB-R-1", "/projects/WEB/regressions/WEB-R-1"), (bySession[0].Kind, bySession[0].Key, bySession[0].Url));
        Assert.Equal(10, byTitle.Count);
        Assert.All(byTitle, i => Assert.StartsWith("Login flow", i.Title, StringComparison.Ordinal));
        Assert.DoesNotContain(byKey.Skip(1), i => i.Key == "WEB-3");
        Assert.Empty(unknownKey);
        Assert.Empty(blank);
    }

    [Fact]
    public async Task My_work_groups_open_assigned_tickets_by_project_and_lists_waiting_regression_items()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var other = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", me);
        var app = await api.SeedProjectAsync("APP", me);
        await api.SeedTicketsAsync(web, me.Id,
            new SeedTicket("Mine low") { AssigneeId = me.Id, Priority = Priority.Low },
            new SeedTicket("Mine high") { AssigneeId = me.Id, Priority = Priority.High, Status = TicketStatus.Testing },
            new SeedTicket("Mine done") { AssigneeId = me.Id, Status = TicketStatus.Done },
            new SeedTicket("Mine deleted") { AssigneeId = me.Id, Deleted = true },
            new SeedTicket("Theirs") { AssigneeId = other.Id });
        await api.SeedTicketsAsync(app, me.Id, new SeedTicket("App work") { AssigneeId = me.Id });
        await api.SeedRegressionAsync(web, "WEB", me, me.Id);
        await api.SeedRegressionAsync(web, "WEB", me, me.Id, cancelled: true);
        await api.SeedRegressionAsync(web, "WEB", me, other.Id);
        var client = await api.LoginAsync(me);

        // Act
        var work = await (await client.GetAsync("/api/v1/me/work", _ct)).ReadAsync<MyWorkDto>();

        // Assert
        Assert.Equal(["APP", "WEB"], work.Projects.Select(p => p.ProjectKey));
        Assert.Equal(["WEB-2", "WEB-1"], work.Projects[1].Tickets.Select(t => t.Key));
        Assert.Equal((3, false), (work.TicketCount, work.Truncated));
        var item = Assert.Single(work.RegressionItems);
        Assert.Equal(("WEB-R-1", "WEB-TC-1", ExecutionMode.Manual), (item.SessionKey, item.TestCaseKey, item.ExecutionMode));
        Assert.Equal("/projects/WEB/regressions/WEB-R-1?item=WEB-TC-1", item.Url);
    }

    private async Task<List<QuickJumpItem>> JumpAsync(HttpClient client, string q) =>
        await (await client.GetAsync($"/api/v1/quick-jump?q={Uri.EscapeDataString(q)}", _ct)).ReadAsync<List<QuickJumpItem>>();
}
