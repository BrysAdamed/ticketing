using Ticketing.Application.TestCases;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Regressions;
using static Ticketing.Application.Achievements.CriterionSql;

namespace Ticketing.Application.Achievements.Criteria;

internal sealed class TestAuthorCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.TestAuthor;

    public override IReadOnlyCollection<string> Triggers { get; } = [CreateTestCase.Action];

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT tc.id)::int AS count
        FROM subjects s
        {ActorEntries(CreateTestCase.Action)}
        JOIN test_cases tc ON tc.id = a.entity_id
        {AliveProject("tc.project_id")}
        GROUP BY s.user_id
        """;
}

internal sealed class RegressionRunnerCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.RegressionRunner;

    public override IReadOnlyCollection<string> Triggers { get; } = [ResultRecorded];

    private const string ResultRecorded = "regression.item.result";

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT (r.id, a.new_value ->> 'testCaseKey'))::int AS count
        FROM subjects s
        {ActorEntries(ResultRecorded)}
        JOIN regression_sessions r ON r.id = a.entity_id
        {AliveProject("r.project_id")}
        WHERE a.new_value ->> 'to' <> '{RegressionItemStatus.WaitingForExecution}'
        GROUP BY s.user_id
        """;
}

internal sealed class FoundItCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.FoundIt;

    public override IReadOnlyCollection<string> Triggers { get; } = [BugCreated];

    private const string BugCreated = "regression.item.bugCreated";

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT t.id)::int AS count
        FROM subjects s
        {ActorEntries(BugCreated)}
        {AliveTicket("(a.new_value ->> 'bugId')::uuid")}
        GROUP BY s.user_id
        """;
}

internal sealed class FullSweepCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.FullSweep;

    public override IReadOnlyCollection<string> Triggers { get; } = [Completed];

    private const string Completed = "regression.completed";

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT r.id)::int AS count
        FROM subjects s
        {ActorEntries(Completed)}
        JOIN regression_sessions r ON r.id = a.entity_id
        {AliveProject("r.project_id")}
        GROUP BY s.user_id
        """;
}
