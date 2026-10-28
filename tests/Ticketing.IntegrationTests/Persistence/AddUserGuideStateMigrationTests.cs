using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Ticketing.Domain.Onboarding;
using Ticketing.Infrastructure.Persistence;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Persistence;

public sealed class AddUserGuideStateMigrationTests
{
    private const string PreviousMigration = "AddDocVersionSnapshots";
    private const string Migration = "AddUserGuideState";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Users_who_have_signed_in_get_welcome_marked_completed()
    {
        // Arrange
        var options = new DbContextOptionsBuilder<TicketingDbContext>();
        TicketingDbContext.Configure(options, await PostgresServer.CreateEmptyDatabaseAsync(_ct));
        await using var db = new TicketingDbContext(options.Options);
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync(PreviousMigration, _ct);
        var signedIn = Guid.NewGuid();
        var neverSignedIn = Guid.NewGuid();
        var deactivated = Guid.NewGuid();
        await InsertUserAsync(db, signedIn, lastLoginAt: DateTimeOffset.UtcNow.AddDays(-3), isActive: true);
        await InsertUserAsync(db, neverSignedIn, lastLoginAt: null, isActive: true);
        await InsertUserAsync(db, deactivated, lastLoginAt: DateTimeOffset.UtcNow.AddDays(-30), isActive: false);

        // Act
        await migrator.MigrateAsync(Migration, _ct);

        // Assert
        var rows = await db.UserGuideStates.AsNoTracking().ToListAsync(_ct);
        Assert.Equal(new[] { deactivated, signedIn }.Order(), rows.Select(r => r.UserId).Order());
        Assert.All(rows, r => Assert.Equal((UserGuideState.WelcomeGuideId, 1, GuideState.Completed), (r.GuideId, r.Version, r.State)));
    }

    private Task InsertUserAsync(TicketingDbContext db, Guid id, DateTimeOffset? lastLoginAt, bool isActive) =>
        db.Database.ExecuteSqlAsync(
            $"""
            INSERT INTO users (id, email, display_name, global_role, is_active, security_stamp, created_at, last_login_at)
            VALUES ({id}, {$"{id:N}@ticketing.test"}, 'Migrated user', 2, {isActive}, {new string('0', 32)}, {DateTimeOffset.UtcNow.AddDays(-60)}, {lastLoginAt})
            """,
            _ct);
}
