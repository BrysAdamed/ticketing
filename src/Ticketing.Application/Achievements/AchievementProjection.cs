using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Ticketing.Application.Abstractions;
using Ticketing.Application.FeatureFlags;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Achievements;

/// <summary>What one projector run did: the users it evaluated and the tiers it awarded.</summary>
public sealed record ProjectionResult(int Users, int Unlocked);

/// <summary>
/// Awards achievement tiers from committed activity (spec 15.6, D-149). <see cref="RunCycleAsync"/> evaluates the users who acted
/// since the last cycle; <see cref="SweepAsync"/> is the nightly safety net over every started user. Both only add tiers
/// (<c>ON CONFLICT DO NOTHING</c>), so re-running either is harmless, and a failure rolls back and is retried on the next run.
/// Nothing here runs inside a user's write.
/// </summary>
public sealed class AchievementProjection(
    ITicketingDbContext db, IFeatureFlags flags, AchievementEvaluator evaluator, IEnumerable<IAchievementCriterion> criteria, TimeProvider time)
{
    /// <summary>
    /// How far a cycle reads back before the watermark: an entry's <c>occurred_at</c> is stamped before its transaction commits,
    /// so an entry can become visible after a cycle whose watermark is already past it.
    /// </summary>
    public static readonly TimeSpan Overlap = TimeSpan.FromMinutes(2);

    public const int BatchSize = 500;

    private const string LockKey = "achievements:projector";

    private readonly IReadOnlyList<IAchievementCriterion> _criteria = [.. criteria];

    /// <summary>
    /// One cycle: users who wrote activity since the watermark (minus <see cref="Overlap"/>), are active, have not opted out and
    /// have the flag on get their triggered criteria re-evaluated. Stamps the start S of such users who have none yet with their
    /// earliest entry in the window, then advances the watermark.
    /// </summary>
    public Task<ProjectionResult> RunCycleAsync(CancellationToken cancellationToken) =>
        db.InTransactionAsync(async ct =>
        {
            await LockAsync(ct);
            var now = time.GetUtcNow();
            var state = await db.AchievementProjectorStates.SingleOrDefaultAsync(s => s.Id == AchievementProjectorState.SingletonId, ct);
            var from = (state?.ProcessedUntil ?? now) - Overlap;

            var window = await db.ActivityEntries.AsNoTracking()
                .Where(a => a.OccurredAt >= from && a.ActorId != null)
                .GroupBy(a => new { a.ActorId, a.Action })
                .Select(g => new { UserId = g.Key.ActorId!.Value, g.Key.Action, FirstAt = g.Min(a => a.OccurredAt) })
                .ToListAsync(ct);
            var actions = window.GroupBy(w => w.UserId).ToDictionary(g => g.Key, g => g.Select(w => w.Action).ToHashSet(StringComparer.Ordinal));
            var firstAt = window.GroupBy(w => w.UserId).ToDictionary(g => g.Key, g => g.Min(w => w.FirstAt));

            var eligible = await EligibleAsync([.. actions.Keys], requireStart: false, ct);
            await StampStartsAsync(eligible.Where(c => c.StartedAt is null).Select(c => (c.Id, firstAt[c.Id])).ToList(), ct);
            var subjects = await SubjectsAsync([.. eligible.Select(c => c.Id)], ct);
            var unlocked = await AwardAsync(subjects, (userId, criterion) => criterion.Triggers is null || criterion.Triggers.Any(actions[userId].Contains), now, ct);

            if (state is null)
                db.AchievementProjectorStates.Add(AchievementProjectorState.Create(now));
            else
                state.Advance(now);
            await db.SaveChangesAsync(ct);
            return new ProjectionResult(subjects.Count, unlocked);
        }, cancellationToken);

    /// <summary>
    /// The safety net: every active user who has not opted out, has a start S and has the flag on is evaluated against the whole
    /// catalogue, in keyset batches of <see cref="BatchSize"/>, each in its own transaction. It never stamps S, so only activity
    /// after each user's start counts.
    /// </summary>
    public async Task<ProjectionResult> SweepAsync(CancellationToken cancellationToken)
    {
        var total = new ProjectionResult(0, 0);
        var after = Guid.Empty;
        while (true)
        {
            var page = await db.Database
                .SqlQuery<Guid>($"""
                    SELECT id AS "Value" FROM users
                    WHERE is_active AND NOT achievements_hidden AND achievements_started_at IS NOT NULL AND id > {after}
                    ORDER BY id LIMIT {BatchSize}
                    """)
                .ToListAsync(cancellationToken);
            if (page.Count == 0)
                return total;
            after = page[^1];
            var batch = await db.InTransactionAsync(async ct =>
            {
                await LockAsync(ct);
                var eligible = await EligibleAsync(page, requireStart: true, ct);
                var subjects = await SubjectsAsync([.. eligible.Select(c => c.Id)], ct);
                var unlocked = await AwardAsync(subjects, (_, _) => true, time.GetUtcNow(), ct);
                return new ProjectionResult(subjects.Count, unlocked);
            }, cancellationToken);
            total = new ProjectionResult(total.Users + batch.Users, total.Unlocked + batch.Unlocked);
        }
    }

    private async Task LockAsync(CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtextextended({LockKey}, 0))", cancellationToken);

    private async Task<List<Candidate>> EligibleAsync(List<Guid> userIds, bool requireStart, CancellationToken cancellationToken)
    {
        if (userIds.Count == 0)
            return [];
        var candidates = await db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id) && u.IsActive && !u.AchievementsHidden && (!requireStart || u.AchievementsStartedAt != null))
            .Select(u => new Candidate(u.Id, u.GlobalRole, u.AchievementsStartedAt))
            .ToListAsync(cancellationToken);
        var on = await flags.EvaluateForAsync(
            AchievementsFeature.FlagKey, [.. candidates.Select(c => new FlagSubject(c.Id, c.Role))], cancellationToken);
        return [.. candidates.Where(c => on.Contains(c.Id))];
    }

    private async Task StampStartsAsync(List<(Guid UserId, DateTimeOffset At)> starts, CancellationToken cancellationToken)
    {
        if (starts.Count == 0)
            return;
        await db.Database.ExecuteSqlRawAsync(
            """
            UPDATE users SET achievements_started_at = s.at
            FROM unnest(@ids, @ats) AS s(id, at)
            WHERE users.id = s.id AND users.achievements_started_at IS NULL AND NOT users.achievements_hidden
            """,
            [
                new NpgsqlParameter("ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = starts.Select(s => s.UserId).ToArray() },
                new NpgsqlParameter("ats", NpgsqlDbType.Array | NpgsqlDbType.TimestampTz) { Value = starts.Select(s => s.At.ToUniversalTime()).ToArray() },
            ],
            cancellationToken);
    }

    private async Task<List<AchievementSubject>> SubjectsAsync(List<Guid> userIds, CancellationToken cancellationToken)
    {
        if (userIds.Count == 0)
            return [];
        return await db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id) && u.AchievementsStartedAt != null && !u.AchievementsHidden)
            .OrderBy(u => u.Id)
            .Select(u => new AchievementSubject(u.Id, u.AchievementsStartedAt!.Value))
            .ToListAsync(cancellationToken);
    }

    private async Task<int> AwardAsync(
        List<AchievementSubject> subjects, Func<Guid, IAchievementCriterion, bool> triggered, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var unlocked = 0;
        foreach (var batch in subjects.Chunk(BatchSize))
        {
            var userIds = batch.Select(s => s.UserId).ToList();
            var held = (await db.UserAchievements.AsNoTracking()
                    .Where(a => userIds.Contains(a.UserId))
                    .GroupBy(a => new { a.UserId, a.AchievementId })
                    .Select(g => new { g.Key.UserId, g.Key.AchievementId, Tier = g.Max(a => (int)a.Tier) })
                    .ToListAsync(cancellationToken))
                .ToDictionary(h => (h.UserId, h.AchievementId), h => h.Tier);
            int Held(Guid userId, string achievementId) => held.GetValueOrDefault((userId, achievementId));

            var achievementIds = _criteria
                .Where(c => AchievementCatalog.Find(c.AchievementId) is { } definition
                    && userIds.Any(u => triggered(u, c) && Held(u, c.AchievementId) < definition.TopTier))
                .Select(c => c.AchievementId)
                .ToHashSet(StringComparer.Ordinal);
            if (achievementIds.Count == 0)
                continue;

            var rows = (await evaluator.EvaluateAsync(batch, achievementIds, cancellationToken))
                .SelectMany(p => Enumerable.Range(Held(p.UserId, p.AchievementId) + 1, Math.Max(0, p.Tier - Held(p.UserId, p.AchievementId)))
                    .Select(tier => (p.UserId, p.AchievementId, Tier: (short)tier)))
                .ToList();
            unlocked += await InsertAsync(rows, now, cancellationToken);
        }

        return unlocked;
    }

    private async Task<int> InsertAsync(List<(Guid UserId, string AchievementId, short Tier)> rows, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (rows.Count == 0)
            return 0;
        return await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO user_achievements (user_id, achievement_id, tier, unlocked_at)
            SELECT r.user_id, r.achievement_id, r.tier, @now FROM unnest(@user_ids, @achievement_ids, @tiers) AS r(user_id, achievement_id, tier)
            ON CONFLICT DO NOTHING
            """,
            [
                new NpgsqlParameter("user_ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = rows.Select(r => r.UserId).ToArray() },
                new NpgsqlParameter("achievement_ids", NpgsqlDbType.Array | NpgsqlDbType.Varchar) { Value = rows.Select(r => r.AchievementId).ToArray() },
                new NpgsqlParameter("tiers", NpgsqlDbType.Array | NpgsqlDbType.Smallint) { Value = rows.Select(r => r.Tier).ToArray() },
                new NpgsqlParameter("now", NpgsqlDbType.TimestampTz) { Value = now.ToUniversalTime() },
            ],
            cancellationToken);
    }

    private sealed record Candidate(Guid Id, GlobalRole Role, DateTimeOffset? StartedAt);
}
