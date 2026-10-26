using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Attachments;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Comments;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Idempotency;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence;

public sealed class TicketingDbContext(DbContextOptions<TicketingDbContext> options) : DbContext(options), ITicketingDbContext
{
    public DbSet<User> Users => Set<User>();

    public DbSet<PersonalAccessToken> PersonalAccessTokens => Set<PersonalAccessToken>();

    public DbSet<Project> Projects => Set<Project>();

    public DbSet<ProjectMember> ProjectMembers => Set<ProjectMember>();

    public DbSet<ProjectCounter> ProjectCounters => Set<ProjectCounter>();

    public DbSet<Ticket> Tickets => Set<Ticket>();

    public DbSet<TicketLink> TicketLinks => Set<TicketLink>();

    public DbSet<Comment> Comments => Set<Comment>();

    public DbSet<Attachment> Attachments => Set<Attachment>();

    public DbSet<TestCase> TestCases => Set<TestCase>();

    public DbSet<RegressionSession> RegressionSessions => Set<RegressionSession>();

    public DbSet<RegressionSessionItem> RegressionSessionItems => Set<RegressionSessionItem>();

    public DbSet<Board> Boards => Set<Board>();

    public DbSet<BoardProject> BoardProjects => Set<BoardProject>();

    public DbSet<ActivityEntry> ActivityEntries => Set<ActivityEntry>();

    public DbSet<FeatureFlag> FeatureFlags => Set<FeatureFlag>();

    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();

    public static void Configure(DbContextOptionsBuilder options, string connectionString) =>
        options
            .UseNpgsql(connectionString, npgsql => npgsql.MigrationsHistoryTable("__ef_migrations_history"))
            .UseSnakeCaseNamingConvention();

    public async Task<T> InTransactionAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken cancellationToken)
    {
        if (Database.CurrentTransaction is not null)
            return await work(cancellationToken);

        var strategy = Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(
            work,
            async (_, state, ct) =>
            {
                await using var transaction = await Database.BeginTransactionAsync(ct);
                var result = await state(ct);
                await transaction.CommitAsync(ct);
                return result;
            },
            verifySucceeded: null,
            cancellationToken);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasPostgresExtension("pg_trgm");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(TicketingDbContext).Assembly);
    }
}
