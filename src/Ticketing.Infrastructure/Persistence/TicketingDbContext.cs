using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Attachments;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Comments;
using Ticketing.Domain.Docs;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Idempotency;
using Ticketing.Domain.Onboarding;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence;

public sealed class TicketingDbContext(DbContextOptions<TicketingDbContext> options) : DbContext(options), ITicketingDbContext, IDataProtectionKeyContext
{
    /// <summary>ASP.NET Core Data Protection key ring (cookie and antiforgery keys), shared by all API instances.</summary>
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    public DbSet<User> Users => Set<User>();

    public DbSet<LoginThrottle> LoginThrottles => Set<LoginThrottle>();

    public DbSet<UserSession> UserSessions => Set<UserSession>();

    public DbSet<PersonalAccessToken> PersonalAccessTokens => Set<PersonalAccessToken>();

    public DbSet<UserGuideState> UserGuideStates => Set<UserGuideState>();

    public DbSet<UserAchievement> UserAchievements => Set<UserAchievement>();

    public DbSet<AchievementProjectorState> AchievementProjectorStates => Set<AchievementProjectorState>();

    public DbSet<Project> Projects => Set<Project>();

    public DbSet<ProjectMember> ProjectMembers => Set<ProjectMember>();

    public DbSet<ProjectCounter> ProjectCounters => Set<ProjectCounter>();

    public DbSet<Ticket> Tickets => Set<Ticket>();

    public DbSet<TicketLink> TicketLinks => Set<TicketLink>();

    public DbSet<Comment> Comments => Set<Comment>();

    public DbSet<TicketWatcher> TicketWatchers => Set<TicketWatcher>();

    public DbSet<Notification> Notifications => Set<Notification>();

    public DbSet<NotificationPreferences> NotificationPreferences => Set<NotificationPreferences>();

    public DbSet<Attachment> Attachments => Set<Attachment>();

    public DbSet<TestCase> TestCases => Set<TestCase>();

    public DbSet<RegressionSession> RegressionSessions => Set<RegressionSession>();

    public DbSet<RegressionSessionItem> RegressionSessionItems => Set<RegressionSessionItem>();

    public DbSet<Board> Boards => Set<Board>();

    public DbSet<BoardProject> BoardProjects => Set<BoardProject>();

    public DbSet<ActivityEntry> ActivityEntries => Set<ActivityEntry>();

    public DbSet<FeatureFlag> FeatureFlags => Set<FeatureFlag>();

    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();

    public DbSet<AgentPromptTemplate> AgentPromptTemplates => Set<AgentPromptTemplate>();

    public DbSet<AgentPromptTemplateVersion> AgentPromptTemplateVersions => Set<AgentPromptTemplateVersion>();

    public DbSet<DocNode> DocNodes => Set<DocNode>();

    public DbSet<DocVersion> DocVersions => Set<DocVersion>();

    public DbSet<DocDraft> DocDrafts => Set<DocDraft>();

    public DbSet<DocReference> DocReferences => Set<DocReference>();

    public static DbContextOptionsBuilder Configure(DbContextOptionsBuilder options, string connectionString) =>
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
