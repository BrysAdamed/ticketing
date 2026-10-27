using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Attachments;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Comments;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Idempotency;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Abstractions;

/// <summary>
/// The persistence surface handlers use. Every entity of the model is exposed here, so feature slices write their
/// queries in their own handler files and never edit the DbContext. Reads should use <c>AsNoTracking</c> projections.
/// </summary>
public interface ITicketingDbContext
{
    DbSet<User> Users { get; }

    DbSet<LoginThrottle> LoginThrottles { get; }

    DbSet<UserSession> UserSessions { get; }

    DbSet<PersonalAccessToken> PersonalAccessTokens { get; }

    DbSet<Project> Projects { get; }

    DbSet<ProjectMember> ProjectMembers { get; }

    DbSet<ProjectCounter> ProjectCounters { get; }

    DbSet<Ticket> Tickets { get; }

    DbSet<TicketLink> TicketLinks { get; }

    DbSet<Comment> Comments { get; }

    DbSet<TicketWatcher> TicketWatchers { get; }

    DbSet<Notification> Notifications { get; }

    DbSet<Attachment> Attachments { get; }

    DbSet<TestCase> TestCases { get; }

    DbSet<RegressionSession> RegressionSessions { get; }

    DbSet<RegressionSessionItem> RegressionSessionItems { get; }

    DbSet<Board> Boards { get; }

    DbSet<BoardProject> BoardProjects { get; }

    DbSet<ActivityEntry> ActivityEntries { get; }

    DbSet<FeatureFlag> FeatureFlags { get; }

    DbSet<IdempotencyRecord> IdempotencyRecords { get; }

    DatabaseFacade Database { get; }

    ChangeTracker ChangeTracker { get; }

    EntityEntry<TEntity> Entry<TEntity>(TEntity entity)
        where TEntity : class;

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Runs <paramref name="work"/> in one database transaction (with the provider's execution strategy).
    /// Re-entrant: when a transaction is already open, the work joins it.
    /// </summary>
    Task<T> InTransactionAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken cancellationToken);
}
