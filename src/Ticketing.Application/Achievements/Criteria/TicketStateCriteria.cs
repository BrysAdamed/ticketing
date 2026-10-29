using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Collaboration;
using Ticketing.Application.Comments;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Tickets;
using static Ticketing.Application.Achievements.CriterionSql;

namespace Ticketing.Application.Achievements.Criteria;

internal sealed class EpicFinisherCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.EpicFinisher;

    public override IReadOnlyCollection<string> Triggers { get; } = [UpdateTicket.FieldChanged];

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT t.id)::int AS count
        FROM subjects s
        {StatusChangesTo(TicketStatus.Done)}
        {AliveTicket("a.entity_id")} AND t.type = {(int)TicketType.Epic} AND t.status = {(int)TicketStatus.Done}
        WHERE EXISTS (SELECT 1 FROM tickets c WHERE c.parent_id = t.id AND c.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM tickets c WHERE c.parent_id = t.id AND c.deleted_at IS NULL AND c.status <> {(int)TicketStatus.Done})
        GROUP BY s.user_id
        """;
}

internal sealed class ShoutOutCriterion : ComputedAchievementCriterion
{
    private const string DescriptionField = "description";

    public override string AchievementId => AchievementCatalog.ShoutOut;

    public override IReadOnlyCollection<string> Triggers { get; } =
        [CreateTicket.Action, UpdateTicket.FieldChanged, AddComment.Action, UpdateComment.Action];

    private static readonly string Sql = $"""
        SELECT * FROM (
            SELECT s.user_id, a.action, a.entity_id AS ticket_id, t.project_id, t.reporter_id, c.id AS comment_id, a.occurred_at,
                CASE a.action
                    WHEN '{UpdateComment.Action}' THEN a.old_value ->> 'body'
                    WHEN '{UpdateTicket.FieldChanged}' THEN a.old_value #>> ARRAY[]::text[]
                END AS old_text,
                CASE a.action
                    WHEN '{CreateTicket.Action}' THEN t.description
                    WHEN '{AddComment.Action}' THEN c.body
                    WHEN '{UpdateComment.Action}' THEN a.new_value ->> 'body'
                    ELSE a.new_value #>> ARRAY[]::text[]
                END AS new_text
            FROM subjects s
            JOIN activity_entries a ON a.actor_id = s.user_id AND a.occurred_at >= s.started_at AND a.entity_type = {(int)ActivityEntityType.Ticket}
                AND ((a.action IN ('{CreateTicket.Action}', '{AddComment.Action}') AND a.field IS NULL)
                  OR (a.action = '{UpdateComment.Action}' AND a.field = '{UpdateComment.Field}')
                  OR (a.action = '{UpdateTicket.FieldChanged}' AND a.field = '{DescriptionField}'))
            {AliveTicket("a.entity_id")}
            LEFT JOIN comments c ON a.action IN ('{AddComment.Action}', '{UpdateComment.Action}') AND c.id = (a.new_value ->> 'commentId')::uuid
            WHERE NOT EXISTS (
                    SELECT 1 FROM user_achievements ua WHERE ua.user_id = s.user_id AND ua.achievement_id = '{AchievementCatalog.ShoutOut}')
              AND (a.action NOT IN ('{AddComment.Action}', '{UpdateComment.Action}') OR (c.id IS NOT NULL AND c.deleted_at IS NULL))
        ) AS m
        WHERE m.new_text LIKE '%](user:%'
        """;

    public override async Task<IReadOnlyList<AchievementCount>> CountAsync(
        ITicketingDbContext db, IReadOnlyList<AchievementSubject> subjects, CancellationToken cancellationToken)
    {
        var texts = await OverSubjects<MentionText>(db, Sql, subjects).ToListAsync(cancellationToken);
        return
        [
            .. MentionRules.Candidates(texts.Select(ToEvent))
                .Select(c => c.Event.ActorId)
                .OfType<Guid>()
                .Distinct()
                .Select(userId => new AchievementCount(userId, 1)),
        ];
    }

    private static TicketEvent ToEvent(MentionText t) => t.Action switch
    {
        CreateTicket.Action => new TicketCreated(t.TicketId, t.ProjectId, t.UserId, t.OccurredAt, t.ReporterId, null, t.NewText),
        AddComment.Action => new CommentAdded(t.TicketId, t.ProjectId, t.UserId, t.OccurredAt, t.CommentId ?? Guid.Empty, t.NewText),
        UpdateComment.Action => new CommentEdited(t.TicketId, t.ProjectId, t.UserId, t.OccurredAt, t.CommentId ?? Guid.Empty, t.OldText, t.NewText),
        _ => new DescriptionChanged(t.TicketId, t.ProjectId, t.UserId, t.OccurredAt, t.OldText, t.NewText),
    };

    private sealed record MentionText(
        Guid UserId, string Action, Guid TicketId, Guid ProjectId, Guid ReporterId, Guid? CommentId, DateTimeOffset OccurredAt,
        string? OldText, string? NewText);
}
