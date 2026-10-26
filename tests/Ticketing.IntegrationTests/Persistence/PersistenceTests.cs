using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Ordering;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Infrastructure.Persistence;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Persistence;

[Collection(nameof(PersistenceCollection))]
public sealed class PersistenceTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Project_counters_are_per_kind_and_race_free()
    {
        // Arrange
        var (projectId, _) = await CreateProjectAsync();

        // Act
        var tickets = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => NextAsync(projectId, CounterKind.Ticket)));
        var testCase = await NextAsync(projectId, CounterKind.TestCase);

        // Assert
        Assert.Equal(Enumerable.Range(1, 20), tickets.Order());
        Assert.Equal(1, testCase);
    }

    [Fact]
    public async Task Allocating_numbers_does_not_change_the_project_row_version()
    {
        // Arrange
        var (projectId, _) = await CreateProjectAsync();
        var before = await api.WithDbAsync(db => db.Projects.Where(p => p.Id == projectId).Select(p => p.RowVersion).SingleAsync(_ct));

        // Act
        await NextAsync(projectId, CounterKind.Ticket);

        // Assert
        var after = await api.WithDbAsync(db => db.Projects.Where(p => p.Id == projectId).Select(p => p.RowVersion).SingleAsync(_ct));
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task Parallel_bottom_inserts_get_distinct_ordered_ranks()
    {
        // Arrange
        var (projectId, ownerId) = await CreateProjectAsync();
        var container = RankContainer.Backlog(projectId);

        // Act
        await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => InTransactionAsync(async (db, sp, ct) =>
        {
            var rank = await sp.GetRequiredService<ITicketRanker>().BottomAsync(container, null, ct);
            var number = await sp.GetRequiredService<IProjectCounters>().NextAsync(projectId, CounterKind.Ticket, ct);
            db.Tickets.Add(Ticket.Create(projectId, number, $"Ticket {number}", TicketType.Bug, ownerId, rank, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync(ct);
            return rank;
        })));

        // Assert
        var rows = await api.WithDbAsync(db => db.Tickets.OrderBy(t => t.Number).Select(t => t.Rank).ToListAsync(_ct));
        Assert.Equal(12, rows.Distinct().Count());
        Assert.Equal(rows.Order(StringComparer.Ordinal), rows);
    }

    [Fact]
    public async Task Long_keys_rebalance_the_container_but_never_the_moving_ticket()
    {
        // Arrange
        var (projectId, ownerId) = await CreateProjectAsync();
        var container = RankContainer.Backlog(projectId);
        var lowRank = "a0" + new string('V', 70);
        var highRank = lowRank + "V";
        var low = await AddTicketAsync(projectId, ownerId, 1, lowRank);
        var high = await AddTicketAsync(projectId, ownerId, 2, highRank);
        var moving = await AddTicketAsync(projectId, ownerId, 3, "b0");

        // Act
        var placed = await InTransactionAsync(async (db, sp, ct) =>
        {
            var ticket = await db.Tickets.SingleAsync(t => t.Id == moving, ct);
            var rank = await sp.GetRequiredService<ITicketRanker>().BetweenAsync(container, lowRank, highRank, [moving], ct);
            ticket.Rerank(rank);
            await db.SaveChangesAsync(ct);
            return rank;
        });

        // Assert
        Assert.True(placed.Length <= Ranks.RebalanceThreshold);
        var order = await api.WithDbAsync(db => db.Tickets.OrderBy(t => t.Rank).Select(t => new { t.Id, t.Rank }).ToListAsync(_ct));
        Assert.Equal([low, moving, high], order.Select(o => o.Id));
        Assert.All(order, o => Assert.True(o.Rank.Length <= Ranks.RebalanceThreshold));
    }

    [Fact]
    public async Task Equal_or_unordered_neighbours_rebalance_instead_of_failing()
    {
        // Arrange
        var (projectId, ownerId) = await CreateProjectAsync();
        var container = RankContainer.Backlog(projectId);
        await AddTicketAsync(projectId, ownerId, 1, "a0");
        await AddTicketAsync(projectId, ownerId, 2, "a0");

        // Act
        var equal = await InTransactionAsync((_, sp, ct) => sp.GetRequiredService<ITicketRanker>().BetweenAsync(container, "a0", "a0", null, ct));
        var reversed = await InTransactionAsync((_, sp, ct) => sp.GetRequiredService<ITicketRanker>().BetweenAsync(container, "a5", "a1", null, ct));

        // Assert
        var ranks = await api.WithDbAsync(db => db.Tickets.Select(t => t.Rank).ToListAsync(_ct));
        Assert.Equal(2, ranks.Distinct().Count());
        Assert.DoesNotContain(equal, ranks);
        Assert.False(string.IsNullOrEmpty(reversed));
    }

    [Fact]
    public async Task Ranker_requires_a_transaction()
    {
        // Arrange
        var (projectId, _) = await CreateProjectAsync();
        await using var scope = api.Services.CreateAsyncScope();

        // Act / Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.ServiceProvider.GetRequiredService<ITicketRanker>().BottomAsync(RankContainer.Backlog(projectId), null, _ct));
    }

    [Fact]
    public async Task Full_text_search_matches_title_and_description_words()
    {
        // Arrange
        var (projectId, ownerId) = await CreateProjectAsync();
        var match = await AddTicketAsync(projectId, ownerId, 1, "a0", "Login page crashes", "Happens when the password is empty");
        await AddTicketAsync(projectId, ownerId, 2, "a1", "Unrelated");

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

    private async Task<T> InTransactionAsync<T>(Func<TicketingDbContext, IServiceProvider, CancellationToken, Task<T>> work)
    {
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<TicketingDbContext>();
        return await db.InTransactionAsync(ct => work(db, scope.ServiceProvider, ct), _ct);
    }

    private async Task<(Guid ProjectId, Guid OwnerId)> CreateProjectAsync()
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

    private Task<Guid> AddTicketAsync(Guid projectId, Guid ownerId, int number, string rank, string title = "Ticket", string? description = null) =>
        api.WithDbAsync(async db =>
        {
            var ticket = Ticket.Create(projectId, number, title, TicketType.Bug, ownerId, rank, DateTimeOffset.UtcNow);
            ticket.ChangeDescription(description);
            db.Tickets.Add(ticket);
            await db.SaveChangesAsync(_ct);
            return ticket.Id;
        });
}
