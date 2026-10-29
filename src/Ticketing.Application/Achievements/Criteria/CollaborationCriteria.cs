using Ticketing.Application.Attachments;
using Ticketing.Application.Comments;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Activity;
using static Ticketing.Application.Achievements.CriterionSql;

namespace Ticketing.Application.Achievements.Criteria;

internal sealed class ConversationalistCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.Conversationalist;

    public override IReadOnlyCollection<string> Triggers { get; } = [AddComment.Action, AddDocComment.Action];

    public override string Sql => $"""
        SELECT s.user_id, count(*)::int AS count
        FROM subjects s
        JOIN comments c ON c.author_id = s.user_id AND c.created_at >= s.started_at AND c.deleted_at IS NULL
        {TicketOrDoc("c.ticket_id", "c.doc_node_id")}
        WHERE {TicketOrDocAlive}
        GROUP BY s.user_id
        """;
}

internal sealed class ShowMeCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.ShowMe;

    public override IReadOnlyCollection<string> Triggers { get; } = [TicketAttachmentAdded, UploadDocAttachment.Action];

    private const string TicketAttachmentAdded = "attachment.added";

    public override string Sql => $"""
        SELECT s.user_id, count(DISTINCT f.id)::int AS count
        FROM subjects s
        {ActorEntries(TicketAttachmentAdded, UploadDocAttachment.Action)}
        JOIN attachments f ON f.id = (a.new_value ->> 'attachmentId')::uuid
        {TicketOrDoc("f.ticket_id", "f.doc_node_id")}
        WHERE {TicketOrDocAlive}
        GROUP BY s.user_id
        """;
}

internal sealed class MachineWhispererCriterion : SqlAchievementCriterion
{
    public override string AchievementId => AchievementCatalog.MachineWhisperer;

    public override IReadOnlyCollection<string>? Triggers => null;

    public override string Sql => $"""
        SELECT s.user_id, 1 AS count
        FROM subjects s
        WHERE EXISTS (
            SELECT 1 FROM activity_entries a
            WHERE a.actor_id = s.user_id AND a.occurred_at >= s.started_at AND a.channel = {(int)WriteChannel.Mcp})
        """;
}
