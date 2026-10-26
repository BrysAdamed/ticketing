using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Users;

namespace Ticketing.Application.FeatureFlags;

/// <summary>
/// A flag in the admin screens. <see cref="UsersOn"/> is how many of the <see cref="ActiveUsers"/> currently evaluate
/// <c>on</c> (spec 6.13).
/// </summary>
public sealed record FlagDto(
    Guid Id,
    string Key,
    string? Description,
    bool Enabled,
    int RolloutPercentage,
    IReadOnlyList<UserLookupDto> TargetUsers,
    IReadOnlyList<GlobalRole> TargetRoles,
    int UsersOn,
    int ActiveUsers,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    UserLookupDto? UpdatedBy,
    uint RowVersion);

internal static class FlagAdmin
{
    public static AppException NotFound(string key) => AppException.NotFound(FeatureFlagErrors.NotFound, $"Feature flag '{key}' was not found.");

    public static async Task<FeatureFlag> FindTrackedAsync(ITicketingDbContext db, string key, CancellationToken cancellationToken)
    {
        var normalized = key.Trim();
        return await db.FeatureFlags.SingleOrDefaultAsync(f => f.Key == normalized, cancellationToken) ?? throw NotFound(key);
    }

    public static async Task EnsureTargetUsersExistAsync(ITicketingDbContext db, IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken)
    {
        if (userIds.Count == 0)
            return;
        var distinct = userIds.Distinct().ToList();
        var found = await db.Users.CountAsync(u => distinct.Contains(u.Id), cancellationToken);
        if (found != distinct.Count)
            throw new AppException(ErrorKind.Validation, FeatureFlagErrors.UnknownTargetUsers, "Some target users do not exist.",
                errors: new Dictionary<string, string[]> { ["targetUserIds"] = ["Some target users do not exist."] });
    }

    /// <summary>Builds the DTOs for the given flags with one query for referenced users and one for the active population.</summary>
    public static async Task<IReadOnlyList<FlagDto>> ToDtosAsync(ITicketingDbContext db, IReadOnlyList<FeatureFlag> flags, CancellationToken cancellationToken)
    {
        var referenced = flags.SelectMany(f => f.TargetUserIds).Concat(flags.Where(f => f.UpdatedById != null).Select(f => f.UpdatedById!.Value)).Distinct().ToList();
        var users = await db.Users
            .AsNoTracking()
            .Where(u => referenced.Contains(u.Id))
            .Select(u => new UserLookupDto(u.Id, u.Email, u.DisplayName, u.IsActive))
            .ToDictionaryAsync(u => u.Id, cancellationToken);
        var population = await db.Users
            .AsNoTracking()
            .Where(u => u.IsActive)
            .Select(u => new { u.Id, u.GlobalRole })
            .ToListAsync(cancellationToken);

        return [.. flags.Select(f => new FlagDto(
            f.Id,
            f.Key,
            f.Description,
            f.Enabled,
            f.RolloutPercentage,
            [.. f.TargetUserIds.Where(users.ContainsKey).Select(id => users[id]).OrderBy(u => u.DisplayName, StringComparer.OrdinalIgnoreCase)],
            [.. f.TargetRoles.Order()],
            population.Count(u => f.Evaluate(u.Id, u.GlobalRole) == FlagVariants.On),
            population.Count,
            f.CreatedAt,
            f.UpdatedAt,
            f.UpdatedById is { } updatedBy ? users.GetValueOrDefault(updatedBy) : null,
            f.RowVersion))];
    }

    public static object Snapshot(FeatureFlag flag) =>
        new { flag.Key, flag.Description, flag.Enabled, flag.RolloutPercentage, flag.TargetUserIds, flag.TargetRoles };
}
