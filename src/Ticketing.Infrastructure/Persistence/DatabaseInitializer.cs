using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence;

public sealed class DatabaseOptions
{
    public const string Section = "Database";

    /// <summary>Apply pending EF Core migrations when the API starts (EF takes a migration lock, so several instances are safe).</summary>
    public bool MigrateOnStartup { get; set; } = true;
}

/// <summary>Startup work: apply migrations, then create the bootstrap Admin when the user table is empty (spec 6.14).</summary>
public sealed partial class DatabaseInitializer(
    TicketingDbContext db,
    IPasswordHasher hasher,
    IConfiguration configuration,
    IOptions<DatabaseOptions> options,
    TimeProvider time,
    ILogger<DatabaseInitializer> logger)
{
    public const string AdminEmailVariable = "TICKETING_BOOTSTRAP_ADMIN_EMAIL";
    public const string AdminPasswordVariable = "TICKETING_BOOTSTRAP_ADMIN_PASSWORD";
    public const string AdminNameVariable = "TICKETING_BOOTSTRAP_ADMIN_NAME";
    private const int MinPasswordLength = 12;

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        if (options.Value.MigrateOnStartup)
        {
            await db.Database.MigrateAsync(cancellationToken);
            LogMigrated(logger);
        }
        await EnsureBootstrapAdminAsync(cancellationToken);
    }

    public async Task EnsureBootstrapAdminAsync(CancellationToken cancellationToken)
    {
        if (await db.Users.AnyAsync(cancellationToken))
            return;

        var email = configuration[AdminEmailVariable];
        var password = configuration[AdminPasswordVariable];
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrEmpty(password))
            throw new InvalidOperationException(
                $"The user table is empty. Set {AdminEmailVariable} and {AdminPasswordVariable} to create the first administrator.");
        if (password.Length < MinPasswordLength)
            throw new InvalidOperationException($"{AdminPasswordVariable} must be at least {MinPasswordLength} characters.");

        var now = time.GetUtcNow();
        var admin = User.Create(email, configuration[AdminNameVariable] ?? "Administrator", GlobalRole.Admin, createdById: null, now);
        admin.SetPasswordHash(hasher.Hash(admin, password));
        db.Users.Add(admin);
        db.ActivityEntries.Add(ActivityEntry.Create(ActivityEntityType.User, admin.Id, null, null, null, now, "user.bootstrapped"));

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            LogBootstrapped(logger, admin.Email);
        }
        catch (DbUpdateException ex) when (ex.IsUniqueViolation())
        {
            db.ChangeTracker.Clear();
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Database migrations applied.")]
    private static partial void LogMigrated(ILogger logger);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Created bootstrap administrator {Email}.")]
    private static partial void LogBootstrapped(ILogger logger, string email);
}
