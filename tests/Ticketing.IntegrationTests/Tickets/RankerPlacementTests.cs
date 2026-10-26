using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Common;
using Ticketing.Domain.Ordering;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Infrastructure.Persistence;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Tickets;

[Collection(nameof(TicketsCollection))]
public sealed class RankerPlacementTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task PlaceMany_rebalances_with_free_slots_when_neighbours_are_too_close()
    {
        // Arrange
        var (projectId, ownerId) = await CreateProjectAsync();
        var low = "a0" + new string('V', 70);
        var lowId = await AddTicketAsync(projectId, ownerId, 1, low);
        var highId = await AddTicketAsync(projectId, ownerId, 2, low + "V");
        var moving = new[] { await AddTicketAsync(projectId, ownerId, 3, "b0"), await AddTicketAsync(projectId, ownerId, 4, "b1") };

        // Act
        await InTransactionAsync(async (db, ranker, ct) =>
        {
            var ranks = await ranker.PlaceManyAsync(RankContainer.Backlog(projectId), RankAnchor.After(lowId), moving.Length, moving, ct);
            var tickets = await db.Tickets.Where(t => moving.Contains(t.Id)).ToDictionaryAsync(t => t.Id, ct);
            for (var i = 0; i < moving.Length; i++)
                tickets[moving[i]].Rerank(ranks[i]);
            return await db.SaveChangesAsync(ct);
        });

        // Assert
        var order = await api.WithDbAsync(db => db.Tickets.OrderBy(t => t.Rank).Select(t => new { t.Id, t.Rank }).ToListAsync(_ct));
        Assert.Equal([lowId, moving[0], moving[1], highId], order.Select(o => o.Id));
        Assert.All(order, o => Assert.True(o.Rank.Length <= Ranks.RebalanceThreshold));
    }

    [Fact]
    public async Task PlaceMany_rejects_an_anchor_outside_the_container()
    {
        // Arrange
        var (projectId, ownerId) = await CreateProjectAsync();
        var moving = await AddTicketAsync(projectId, ownerId, 1, "a0");

        // Act
        var error = await Assert.ThrowsAsync<DomainException>(() =>
            InTransactionAsync((_, ranker, ct) => ranker.PlaceManyAsync(RankContainer.Backlog(projectId), RankAnchor.Before(Guid.NewGuid()), 1, [moving], ct)));

        // Assert
        Assert.Equal(TicketErrors.RankAnchorInvalid, error.Code);
    }

    private async Task<T> InTransactionAsync<T>(Func<TicketingDbContext, ITicketRanker, CancellationToken, Task<T>> work)
    {
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<TicketingDbContext>();
        var ranker = scope.ServiceProvider.GetRequiredService<ITicketRanker>();
        return await db.InTransactionAsync(ct => work(db, ranker, ct), _ct);
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

    private Task<Guid> AddTicketAsync(Guid projectId, Guid ownerId, int number, string rank) =>
        api.WithDbAsync(async db =>
        {
            var ticket = Ticket.Create(projectId, number, $"Ticket {number}", TicketType.Bug, ownerId, rank, DateTimeOffset.UtcNow);
            db.Tickets.Add(ticket);
            await db.SaveChangesAsync(_ct);
            return ticket.Id;
        });
}
