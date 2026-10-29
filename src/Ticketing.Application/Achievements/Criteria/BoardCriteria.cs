using Ticketing.Domain.Achievements;
using static Ticketing.Application.Achievements.CriterionSql;

namespace Ticketing.Application.Achievements.Criteria;

internal sealed class BoardBuilderCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.BoardBuilder;

    public override IReadOnlyCollection<string> Triggers { get; } = [Created];

    private const string Created = "board.created";

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT b.id)::int AS count
        FROM subjects s
        {ActorEntries(Created)}
        JOIN boards b ON b.id = a.entity_id AND b.deleted_at IS NULL
        GROUP BY s.user_id
        """;
}

internal sealed class SpringCleaningCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.SpringCleaning;

    public override IReadOnlyCollection<string> Triggers { get; } = [Archived];

    private const string Archived = "board.archived";

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT a.entity_id)::int AS count
        FROM subjects s
        {ActorEntries(Archived)}
        GROUP BY s.user_id
        """;
}
