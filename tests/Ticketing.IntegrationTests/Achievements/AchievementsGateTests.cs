using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Achievements;
using Ticketing.Application.Common;
using Ticketing.Domain.Achievements;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary><see cref="AchievementsGate"/>: the <c>achievements</c> flag per user, and stamping the start S (D-145).</summary>
[Collection(nameof(AchievementsCollection))]
public sealed class AchievementsGateTests(TicketingApiFactory api)
{
    [Fact]
    public async Task While_the_flag_is_off_the_gate_is_closed_with_a_404_and_no_start_is_stamped()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var other = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(other);

        // Act
        var open = await GateAsync(user, g => g.IsEnabledAsync(TestContext.Current.CancellationToken));
        var error = await Assert.ThrowsAsync<AppException>(() => GateAsync(user, g => g.EnsureStartedAsync(TestContext.Current.CancellationToken)));

        // Assert
        Assert.False(open);
        Assert.Equal((ErrorKind.NotFound, AchievementErrors.Disabled), (error.Kind, error.Code));
        Assert.Null(await StartOfAsync(user));
    }

    [Fact]
    public async Task The_first_open_gate_stamps_the_start_and_later_calls_and_a_flag_off_and_on_keep_it()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);

        // Act
        var first = await GateAsync(user, g => g.EnsureStartedAsync(TestContext.Current.CancellationToken));
        await api.SetAchievementsFlagAsync();
        await api.SetAchievementsFlagAsync(user);
        var second = await GateAsync(user, g => g.EnsureStartedAsync(TestContext.Current.CancellationToken));

        // Assert
        Assert.NotNull(first);
        Assert.Equal(first, second);
        Assert.Equal(first, await StartOfAsync(user));
    }

    [Fact]
    public async Task A_user_who_opted_out_gets_no_start_until_they_opt_back_in()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);
        await api.WithDbAsync(async db =>
        {
            var entity = await db.Users.SingleAsync(u => u.Id == user.Id);
            entity.OptOutOfAchievements();
            return await db.SaveChangesAsync();
        });

        // Act
        var start = await GateAsync(user, g => g.EnsureStartedAsync(TestContext.Current.CancellationToken));

        // Assert
        Assert.Null(start);
        Assert.Null(await StartOfAsync(user));
    }

    private Task<T> GateAsync<T>(TestUser user, Func<AchievementsGate, Task<T>> work) =>
        api.ExecuteAsAsync(user, sp => work(sp.GetRequiredService<AchievementsGate>()));

    private Task<DateTimeOffset?> StartOfAsync(TestUser user) =>
        api.WithDbAsync(db => db.Users.Where(u => u.Id == user.Id).Select(u => u.AchievementsStartedAt).SingleAsync());
}
