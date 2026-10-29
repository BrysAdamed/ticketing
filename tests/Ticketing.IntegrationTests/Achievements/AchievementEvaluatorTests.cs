using System.Collections.Concurrent;
using System.Data.Common;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Achievements;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Projects;
using Ticketing.Infrastructure.Persistence;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Mentions;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary>The evaluator itself (spec 15.4): one criterion per catalogue entry, per-user starts, and a query count independent of users.</summary>
[Collection(nameof(AchievementsCollection))]
public sealed class AchievementEvaluatorTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public void Every_catalogue_entry_has_exactly_one_criterion_and_every_criterion_an_entry()
    {
        // Act
        var criteria = api.Services.GetServices<IAchievementCriterion>().Select(c => c.AchievementId).ToList();

        // Assert
        Assert.Equal(AchievementCatalog.All.Select(a => a.Id).Order(), criteria.Order());
    }

    [Fact]
    public async Task A_batch_returns_every_achievement_for_every_user_each_counted_from_their_own_start()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var early = await api.CreateUserAsync();
        var late = await api.CreateUserAsync();
        var idle = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var project = await ownerClient.CreateProjectAsync("WEB");
        await api.AddMemberAsync(project.Id, early, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, late, ProjectRole.Member);
        var earlyClient = await api.LoginAsync(early);
        var lateClient = await api.LoginAsync(late);
        var earlyStart = DateTimeOffset.UtcNow;
        await earlyClient.CreateTicketAsync("WEB", "Early one", "Bug");
        await lateClient.CreateTicketAsync("WEB", "Before late's start");
        var lateStart = DateTimeOffset.UtcNow;
        await earlyClient.CreateTicketAsync("WEB", "Early two");
        await lateClient.CreateTicketAsync("WEB", "After late's start");

        // Act
        var progress = await api.EvaluateAsync([new(early.Id, earlyStart), new(late.Id, lateStart), new(idle.Id, earlyStart)]);

        // Assert
        Assert.Equal(3 * AchievementCatalog.All.Count, progress.Count);
        Assert.Equal((2, 1), Of(progress, early, AchievementCatalog.Reporter));
        Assert.Equal((1, 1), Of(progress, early, AchievementCatalog.BugHunter));
        Assert.Equal((1, 1), Of(progress, late, AchievementCatalog.Reporter));
        Assert.All(progress.Where(p => p.UserId == idle.Id), p => Assert.Equal((0, 0), (p.Count, p.Tier)));
    }

    [Fact]
    public async Task The_number_of_queries_is_the_same_for_one_user_and_for_many()
    {
        // Arrange
        var recorder = new CommandRecorder();
        await using var host = api.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.ConfigureDbContext<TicketingDbContext>(o => o.AddInterceptors(recorder))));
        var users = new List<TestUser>();
        for (var i = 0; i < 25; i++)
            users.Add(await api.CreateUserAsync());
        var start = DateTimeOffset.UtcNow.AddMinutes(-1);
        var owner = await api.LoginAsync(users[0]);
        var project = await owner.CreateProjectAsync("WEB");
        var ticket = await owner.CreateTicketAsync("WEB", "Busy");
        for (var i = 1; i <= 5; i++)
        {
            await api.AddMemberAsync(project.Id, users[i], ProjectRole.Member);
            var member = await api.LoginAsync(users[i]);
            await member.AddCommentAsync(ticket.Key, $"Hello {users[0].Mention()}");
            await member.PatchTicketAsync((await member.CreateTicketAsync("WEB", $"Task {i}", extra: new { description = users[0].Mention() })).Key, new { status = "Done" });
        }
        var computed = api.Services.GetServices<IAchievementCriterion>().OfType<ComputedAchievementCriterion>().Count();

        // Act
        var one = await CountQueriesAsync(host.Services, recorder, [new(users[1].Id, start)]);
        var many = await CountQueriesAsync(host.Services, recorder, [.. users.Select(u => new AchievementSubject(u.Id, start))]);

        // Assert
        Assert.Equal(1 + computed, one);
        Assert.Equal(one, many);
    }

    [Fact]
    public async Task Computed_criteria_are_called_once_per_batch_and_unselected_criteria_not_at_all()
    {
        // Arrange
        var users = new[] { await api.CreateUserAsync(), await api.CreateUserAsync() };
        var computed = new FakeComputedCriterion(users[1].Id, 12);
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ITicketingDbContext>();
        var evaluator = new AchievementEvaluator(db, [computed, .. scope.ServiceProvider.GetServices<IAchievementCriterion>()
            .Where(c => c.AchievementId != AchievementCatalog.Reporter)]);
        var subjects = users.Select(u => new AchievementSubject(u.Id, DateTimeOffset.UtcNow)).ToList();

        // Act
        var progress = await evaluator.EvaluateAsync(subjects, [AchievementCatalog.Reporter, AchievementCatalog.Closer], _ct);
        var skipped = await evaluator.EvaluateAsync(subjects, [AchievementCatalog.Closer], _ct);

        // Assert
        Assert.Equal(1, computed.Calls);
        Assert.Equal((12, 2), Of(progress, users[1], AchievementCatalog.Reporter));
        Assert.Equal((0, 0), Of(progress, users[0], AchievementCatalog.Reporter));
        Assert.Equal(4, progress.Count);
        Assert.Equal([AchievementCatalog.Closer], skipped.Select(p => p.AchievementId).Distinct());
    }

    [Fact]
    public async Task A_user_may_appear_only_once_in_a_batch()
    {
        // Arrange
        var user = await api.CreateUserAsync();

        // Act
        var act = () => api.EvaluateAsync([new(user.Id, DateTimeOffset.UtcNow), new(user.Id, DateTimeOffset.UtcNow.AddDays(-1))]);

        // Assert
        await Assert.ThrowsAsync<ArgumentException>(act);
    }

    private static (int Count, int Tier) Of(IReadOnlyList<AchievementProgress> progress, TestUser user, string achievementId) =>
        progress.Where(p => p.UserId == user.Id && p.AchievementId == achievementId).Select(p => (p.Count, p.Tier)).Single();

    private async Task<int> CountQueriesAsync(
        IServiceProvider services, CommandRecorder recorder, IReadOnlyCollection<AchievementSubject> subjects)
    {
        await using var scope = services.CreateAsyncScope();
        var evaluator = scope.ServiceProvider.GetRequiredService<AchievementEvaluator>();
        recorder.Clear();
        await evaluator.EvaluateAsync(subjects, null, _ct);
        return recorder.Count;
    }

    private sealed class FakeComputedCriterion(Guid userId, int count) : ComputedAchievementCriterion
    {
        public int Calls { get; private set; }

        public override string AchievementId => AchievementCatalog.Reporter;

        public override IReadOnlyCollection<string>? Triggers => null;

        public override Task<IReadOnlyList<AchievementCount>> CountAsync(
            ITicketingDbContext db, IReadOnlyList<AchievementSubject> subjects, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult<IReadOnlyList<AchievementCount>>([new AchievementCount(userId, count)]);
        }
    }

    private sealed class CommandRecorder : DbCommandInterceptor
    {
        private readonly ConcurrentQueue<string> _statements = new();

        public int Count => _statements.Count;

        public void Clear() => _statements.Clear();

        public override ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default)
        {
            _statements.Enqueue(command.CommandText);
            return ValueTask.FromResult(result);
        }
    }
}
