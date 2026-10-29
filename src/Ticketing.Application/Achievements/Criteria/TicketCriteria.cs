using Ticketing.Application.Agents;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Tickets;
using static Ticketing.Application.Achievements.CriterionSql;

namespace Ticketing.Application.Achievements.Criteria;

internal sealed class ReporterCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.Reporter;

    public override IReadOnlyCollection<string> Triggers { get; } = [CreateTicket.Action];

    public override string Sql => TicketsCreated(typeFilter: "");

    internal static string TicketsCreated(string typeFilter) => $"""
        SELECT s.user_id, count(*)::int AS count
        FROM subjects s
        JOIN tickets t ON t.created_by_id = s.user_id AND t.created_at >= s.started_at AND t.deleted_at IS NULL {typeFilter}
        {AliveProject("t.project_id")}
        GROUP BY s.user_id
        """;
}

internal sealed class BugHunterCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.BugHunter;

    public override IReadOnlyCollection<string> Triggers { get; } = [CreateTicket.Action, UpdateTicket.FieldChanged];

    public override string Sql => ReporterCriterion.TicketsCreated($"AND t.type = {(int)TicketType.Bug}");
}

internal sealed class CloserCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.Closer;

    public override IReadOnlyCollection<string> Triggers { get; } = [UpdateTicket.FieldChanged];

    public override string Sql => MovedTo(TicketStatus.Done, typeFilter: "");

    internal static string MovedTo(TicketStatus status, string typeFilter) => $"""
        SELECT s.user_id, count(DISTINCT t.id)::int AS count
        FROM subjects s
        {StatusChangesTo(status)}
        {AliveTicket("a.entity_id")} {typeFilter}
        GROUP BY s.user_id
        """;
}

internal sealed class ExterminatorCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.Exterminator;

    public override IReadOnlyCollection<string> Triggers { get; } = [UpdateTicket.FieldChanged];

    public override string Sql => CloserCriterion.MovedTo(TicketStatus.Done, $"AND t.type = {(int)TicketType.Bug}");
}

internal sealed class ReadyForReviewCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.ReadyForReview;

    public override IReadOnlyCollection<string> Triggers { get; } = [UpdateTicket.FieldChanged];

    public override string Sql => CloserCriterion.MovedTo(TicketStatus.Review, typeFilter: "");
}

internal sealed class TriageCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.Triage;

    public override IReadOnlyCollection<string> Triggers { get; } = [CreateTicket.Action, UpdateTicket.FieldChanged];

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT t.id)::int AS count
        FROM subjects s
        JOIN (
            SELECT a.actor_id, a.entity_id, a.occurred_at,
                CASE WHEN jsonb_typeof(a.new_value) = 'string' THEN btrim(a.new_value::text, '"')::uuid END AS assignee_id
            FROM activity_entries a
            WHERE a.action = '{UpdateTicket.FieldChanged}' AND a.field = 'assignee'
            UNION ALL
            SELECT a.actor_id, a.entity_id, a.occurred_at, (a.new_value ->> 'assigneeId')::uuid
            FROM activity_entries a
            WHERE a.action = '{CreateTicket.Action}' AND a.field IS NULL
        ) AS a ON a.actor_id = s.user_id AND a.occurred_at >= s.started_at AND a.assignee_id <> s.user_id
        {AliveTicket("a.entity_id")}
        GROUP BY s.user_id
        """;
}

internal sealed class ConnectorCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.Connector;

    public override IReadOnlyCollection<string> Triggers { get; } = [LinkAdded];

    private const string LinkAdded = "ticket.link.added";

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT l.id)::int AS count
        FROM subjects s
        {ActorEntries(LinkAdded)}
        JOIN ticket_links l ON l.created_by_id = s.user_id AND l.created_at = a.occurred_at
            AND ((l.source_ticket_id = a.entity_id AND l.target_ticket_id = (a.new_value ->> 'ticketId')::uuid)
              OR (l.target_ticket_id = a.entity_id AND l.source_ticket_id = (a.new_value ->> 'ticketId')::uuid))
        GROUP BY s.user_id
        """;
}

internal sealed class DelegatorCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.Delegator;

    public override IReadOnlyCollection<string> Triggers { get; } = [RecordAgentDelegation.Action];

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT t.id)::int AS count
        FROM subjects s
        {ActorEntries(RecordAgentDelegation.Action)}
        {AliveTicket("a.entity_id")}
        GROUP BY s.user_id
        """;
}
