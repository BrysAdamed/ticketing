using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Achievements;

namespace Ticketing.Application.Achievements;

/// <summary>A user's current count for one achievement and the tier it reaches (0 while none; spec 15.4).</summary>
public sealed record AchievementProgress(Guid UserId, string AchievementId, int Count, int Tier);

/// <summary>
/// Computes achievement criteria for a batch of users, each from their own start S (spec 15.4, D-145). All SQL criteria run in
/// one query and every computed criterion once per batch, so the number of queries does not depend on the number of users.
/// The evaluator only reads: awarding tiers is the projector's job (TKT-64), showing progress the API's (TKT-65).
/// </summary>
public sealed class AchievementEvaluator(ITicketingDbContext db, IEnumerable<IAchievementCriterion> criteria)
{
    private readonly IReadOnlyList<IAchievementCriterion> _criteria = [.. criteria];

    /// <summary>
    /// Returns one entry per subject and achievement, counts of 0 included. <paramref name="achievementIds"/> limits the work to
    /// those achievements (for example the ones a projector cycle found triggered); null evaluates the whole catalogue.
    /// </summary>
    public async Task<IReadOnlyList<AchievementProgress>> EvaluateAsync(
        IReadOnlyCollection<AchievementSubject> subjects, IReadOnlyCollection<string>? achievementIds, CancellationToken cancellationToken)
    {
        if (subjects.Select(s => s.UserId).Distinct().Count() != subjects.Count)
            throw new ArgumentException("Each user may appear only once in a batch.", nameof(subjects));
        var selected = _criteria
            .Where(c => achievementIds is null || achievementIds.Contains(c.AchievementId))
            .Select(c => (Criterion: c, Definition: AchievementCatalog.Find(c.AchievementId)
                ?? throw new InvalidOperationException($"Criterion '{c.AchievementId}' has no catalogue entry.")))
            .ToList();
        if (subjects.Count == 0 || selected.Count == 0)
            return [];

        var subjectList = subjects.ToList();
        var counts = new Dictionary<(Guid UserId, string AchievementId), int>();
        var sqlCriteria = selected.Select(s => s.Criterion).OfType<SqlAchievementCriterion>().ToList();
        foreach (var row in await SqlCountsAsync(subjectList, sqlCriteria, cancellationToken))
            counts[(row.UserId, row.AchievementId)] = row.Count;
        foreach (var criterion in selected.Select(s => s.Criterion).OfType<ComputedAchievementCriterion>())
        {
            foreach (var count in await criterion.CountAsync(db, subjectList, cancellationToken))
                counts[(count.UserId, criterion.AchievementId)] = count.Count;
        }

        return
        [
            .. from subject in subjectList
            from s in selected
            let count = counts.GetValueOrDefault((subject.UserId, s.Definition.Id))
            select new AchievementProgress(subject.UserId, s.Definition.Id, count, s.Definition.TierFor(count)),
        ];
    }

    private async Task<List<CriterionRow>> SqlCountsAsync(
        List<AchievementSubject> subjects, List<SqlAchievementCriterion> sqlCriteria, CancellationToken cancellationToken)
    {
        if (sqlCriteria.Count == 0)
            return [];

        var sql = new StringBuilder("WITH subjects AS MATERIALIZED (SELECT * FROM unnest(@user_ids, @started_ats) AS s(user_id, started_at))\n");
        for (var i = 0; i < sqlCriteria.Count; i++)
        {
            if (i > 0)
                sql.Append("UNION ALL\n");
            sql.Append($"SELECT '{sqlCriteria[i].AchievementId}' AS achievement_id, c.user_id, c.count FROM (\n{sqlCriteria[i].Sql}\n) AS c\n");
        }

        return await db.Database.SqlQueryRaw<CriterionRow>(
                sql.ToString().Replace("{", "{{", StringComparison.Ordinal).Replace("}", "}}", StringComparison.Ordinal),
                new NpgsqlParameter("user_ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = subjects.Select(s => s.UserId).ToArray() },
                new NpgsqlParameter("started_ats", NpgsqlDbType.Array | NpgsqlDbType.TimestampTz)
                {
                    Value = subjects.Select(s => s.StartedAt.ToUniversalTime()).ToArray(),
                })
            .ToListAsync(cancellationToken);
    }

    private sealed record CriterionRow(string AchievementId, Guid UserId, int Count);
}
