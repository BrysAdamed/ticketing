using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Ordering;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Persistence;

[Collection(nameof(ApiCollection))]
public sealed class PersistenceTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Project_counters_are_per_kind_and_race_free()
    {
        // Arrange
        var projectId = await CreateProjectAsync();

        // Act
        var tickets = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => NextAsync(projectId, CounterKind.Ticket)));
        var testCase = await NextAsync(projectId, CounterKind.TestCase);

        // Assert
        Assert.Equal(Enumerable.Range(1, 20), tickets.Order());
        Assert.Equal(1, testCase);
    }

    [Fact]
    public async Task Allocating_numbers_does_not_change_the_project_version()
    {
        // Arrange
        var projectId = await CreateProjectAsync();
        var before = await api.WithDbAsync(db => db.Projects.Where(p => p.Id == projectId).Select(p => p.RowVersion).SingleAsync(_ct));

        // Act
        await NextAsync(projectId, CounterKind.Ticket);

        // Assert
        var after = await api.WithDbAsync(db => db.Projects.Where(p => p.Id == projectId).Select(p => p.RowVersion).SingleAsync(_ct));
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task Ranker_appends_prepends_and_rebalances_long_keys()
    {
        // Arrange
        var (projectId, ownerId) = await CreateProjectWithOwnerAsync();
        var container = RankContainer.Backlog(projectId);
        var lowRank = "a0" + new string('V', 70);
        var highRank = lowRank + "V";
        var first = await AddTicketAsync(projectId, ownerId, lowRank);
        var last = await AddTicketAsync(projectId, ownerId, highRank);

        // Act
        var top = await WithRankerAsync(r => r.TopAsync(container, _ct));
        var bottom = await WithRankerAsync(r => r.BottomAsync(container, _ct));
        var between = await WithRankerAsync(r => r.BetweenAsync(container, lowRank, highRank, null, _ct));

        // Assert
        Assert.True(string.CompareOrdinal(top, lowRank) < 0);
        Assert.True(string.CompareOrdinal(bottom, highRank) > 0);
        Assert.True(between.Length <= Ranks.RebalanceThreshold);
        var ranks = await api.WithDbAsync(db => db.Tickets.OrderBy(t => t.Rank).Select(t => new { t.Id, t.Rank }).ToListAsync(_ct));
        Assert.Equal([first, last], ranks.Select(r => r.Id));
        Assert.All(ranks, r => Assert.True(r.Rank.Length <= Ranks.RebalanceThreshold));
        Assert.True(string.CompareOrdinal(ranks[0].Rank, between) < 0 && string.CompareOrdinal(between, ranks[1].Rank) < 0);
    }

    [Fact]
    public async Task Full_text_search_matches_title_and_description_words()
    {
        // Arrange
        var (projectId, ownerId) = await CreateProjectWithOwnerAsync();
        var match = await AddTicketAsync(projectId, ownerId, "a0", "Login page crashes", "Happens when the password is empty");
        await AddTicketAsync(projectId, ownerId, "a1", "Unrelated");

        // Act
        var found = await api.WithDbAsync(db => db.Tickets
            .Where(t => EF.Property<NpgsqlTsVector>(t, TicketSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(TicketSearch.Configuration, "crashing passwords")))
            .Select(t => t.Id)
            .ToListAsync(_ct));

        // Assert
        Assert.Equal([match], found);
    }

    private async Task<int> NextAsync(Guid projectId, CounterKind kind)
    {
        await using var scope = api.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IProjectCounters>().NextAsync(projectId, kind, _ct);
    }

    private async Task<string> WithRankerAsync(Func<ITicketRanker, Task<string>> work)
    {
        await using var scope = api.Services.CreateAsyncScope();
        return await work(scope.ServiceProvider.GetRequiredService<ITicketRanker>());
    }

    private async Task<Guid> CreateProjectAsync() => (await CreateProjectWithOwnerAsync()).ProjectId;

    private async Task<(Guid ProjectId, Guid OwnerId)> CreateProjectWithOwnerAsync()
    {
        var owner = await api.CreateUserAsync();
        var projectId = await api.WithDbAsync(async db =>
        {
            var project = Project.Create("WEB", "Website", null, ProjectVisibility.Private, owner.Id, DateTimeOffset.UtcNow);
            db.Projects.Add(project);
            await db.SaveChangesAsync(_ct);
            return project.Id;
        });
        return (projectId, owner.Id);
    }

    private Task<Guid> AddTicketAsync(Guid projectId, Guid ownerId, string rank, string title = "Ticket", string? description = null) =>
        api.WithDbAsync(async db =>
        {
            var number = await db.Tickets.CountAsync(_ct) + 1;
            var ticket = Ticket.Create(projectId, number, title, TicketType.Bug, ownerId, rank, DateTimeOffset.UtcNow);
            ticket.ChangeDescription(description);
            db.Tickets.Add(ticket);
            await db.SaveChangesAsync(_ct);
            return ticket.Id;
        });
}
