using Ticketing.Application.Abstractions;

namespace Ticketing.Application.Achievements;

/// <summary>A user whose achievements are evaluated, with their start S: only activity at or after it counts (D-145).</summary>
public sealed record AchievementSubject(Guid UserId, DateTimeOffset StartedAt);

/// <summary>A criterion's current count for one user.</summary>
public sealed record AchievementCount(Guid UserId, int Count);

/// <summary>
/// How one catalogue entry is counted (spec 15.4). Every <see cref="Domain.Achievements.AchievementCatalog"/> entry has exactly
/// one criterion; implementations are discovered by scanning, so adding an achievement touches no evaluator, projector, API or UI
/// code. Implement <see cref="SqlAchievementCriterion"/> when the count is a query, or <see cref="ComputedAchievementCriterion"/>
/// when it needs C# (for example parsing text).
/// </summary>
public interface IAchievementCriterion
{
    /// <summary>The catalogue id this criterion counts.</summary>
    string AchievementId { get; }

    /// <summary>
    /// The activity actions after which the count can grow, so a projector cycle can skip criteria nobody triggered.
    /// Null means any action can (for example a criterion on the channel).
    /// </summary>
    IReadOnlyCollection<string>? Triggers { get; }
}

/// <summary>
/// A criterion written as one SQL <c>SELECT</c> with the columns <c>user_id</c> and <c>count</c> (an <c>int</c>) per user, over
/// the CTE <c>subjects(user_id, started_at)</c>. The evaluator runs every SQL criterion of a batch in one query, so the number
/// of queries never depends on the number of users. Count distinct entities, only at or after <c>started_at</c>, and only
/// entities that are still alive (<see cref="CriterionSql"/>). The SQL may inline constants but never user input.
/// </summary>
public abstract class SqlAchievementCriterion : IAchievementCriterion
{
    public abstract string AchievementId { get; }

    public abstract IReadOnlyCollection<string>? Triggers { get; }

    public abstract string Sql { get; }
}

/// <summary>
/// A criterion computed in C#. <see cref="CountAsync"/> is called once per batch with every subject and must use a fixed
/// number of queries, independent of the number of subjects. Users without a count may be left out.
/// </summary>
public abstract class ComputedAchievementCriterion : IAchievementCriterion
{
    public abstract string AchievementId { get; }

    public abstract IReadOnlyCollection<string>? Triggers { get; }

    public abstract Task<IReadOnlyList<AchievementCount>> CountAsync(
        ITicketingDbContext db, IReadOnlyList<AchievementSubject> subjects, CancellationToken cancellationToken);
}
