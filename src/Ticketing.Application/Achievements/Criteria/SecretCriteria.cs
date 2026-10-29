using Ticketing.Application.Docs;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Tickets;
using static Ticketing.Application.Achievements.CriterionSql;

namespace Ticketing.Application.Achievements.Criteria;

internal sealed class SecondThoughtsCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.SecondThoughts;

    public override IReadOnlyCollection<string> Triggers { get; } = [RestoreTicket.Action, RestoreDoc.Action];

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT a.id)::int AS count
        FROM subjects s
        {ActorEntries(RestoreTicket.Action, RestoreDoc.Action)}
        JOIN LATERAL (
            SELECT d.actor_id, d.occurred_at
            FROM activity_entries d
            WHERE d.entity_type = a.entity_type AND d.entity_id = a.entity_id AND d.field IS NULL
              AND d.action IN ('{DeleteTicket.Action}', '{DeleteDoc.Action}') AND d.occurred_at <= a.occurred_at
            ORDER BY d.occurred_at DESC
            LIMIT 1
        ) AS d ON d.actor_id = s.user_id AND d.occurred_at >= s.started_at
            AND a.occurred_at <= d.occurred_at + make_interval(mins => CASE a.action
                WHEN '{RestoreTicket.Action}' THEN {Ticket.RestoreWindowMinutes} ELSE {DocNode.RestoreWindowMinutes} END)
        GROUP BY s.user_id
        """;
}

internal sealed class UnblockerCriterion : SqlAchievementCriterion
{
    private const int OpenTicketsBlocked = 3;

    public override string AchievementId => AchievementCatalog.Unblocker;

    public override IReadOnlyCollection<string> Triggers { get; } = [UpdateTicket.FieldChanged];

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT t.id)::int AS count
        FROM subjects s
        {StatusChangesTo(TicketStatus.Done)}
        {AliveTicket("a.entity_id")} AND t.status = {(int)TicketStatus.Done}
        WHERE (
            SELECT count(*)
            FROM ticket_links l
            JOIN tickets b ON b.id = l.target_ticket_id AND b.deleted_at IS NULL AND b.status <> {(int)TicketStatus.Done}
            JOIN projects bp ON bp.id = b.project_id AND bp.deleted_at IS NULL
            WHERE l.source_ticket_id = t.id AND l.type = {(int)TicketLinkType.Blocks}
        ) >= {OpenTicketsBlocked}
        GROUP BY s.user_id
        """;
}

internal sealed class GrandTourCriterion : SqlAchievementCriterion
{
    private const string StatusChange = $"a.action = '{UpdateTicket.FieldChanged}' AND a.field = 'status'";

    public override string AchievementId => AchievementCatalog.GrandTour;

    public override IReadOnlyCollection<string> Triggers { get; } = [UpdateTicket.FieldChanged];

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT t.id)::int AS count
        FROM subjects s
        JOIN LATERAL (
            SELECT DISTINCT a.entity_id
            FROM activity_entries a
            WHERE a.actor_id = s.user_id AND {StatusChange} AND a.occurred_at >= s.started_at
        ) AS w ON true
        {AliveTicket("w.entity_id")}
        WHERE (
            SELECT count(DISTINCT v.status)
            FROM activity_entries a
            CROSS JOIN LATERAL (VALUES (a.old_value), (a.new_value)) AS v(status)
            WHERE a.entity_type = {(int)ActivityEntityType.Ticket} AND a.entity_id = t.id AND {StatusChange}
              AND a.occurred_at >= s.started_at AND jsonb_typeof(v.status) = 'string'
        ) >= {Enum.GetValues<TicketStatus>().Length}
        GROUP BY s.user_id
        """;
}
