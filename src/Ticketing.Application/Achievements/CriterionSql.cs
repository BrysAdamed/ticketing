using Ticketing.Application.Tickets;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Achievements;

/// <summary>
/// Building blocks for <see cref="SqlAchievementCriterion"/> fragments, so every criterion applies the shared terms of D-145 the
/// same way: <c>s</c> is the subject, <c>a</c> its activity entry, <c>t</c> and <c>p</c> an alive ticket and its project.
/// </summary>
public static class CriterionSql
{
    /// <summary>The subject's own entries of <paramref name="actions"/> (no field) at or after S.</summary>
    public static string ActorEntries(params string[] actions) =>
        $"JOIN activity_entries a ON a.actor_id = s.user_id AND a.action IN ({string.Join(", ", actions.Select(Literal))}) AND a.field IS NULL AND a.occurred_at >= s.started_at";

    /// <summary>The subject's own status changes to <paramref name="status"/> at or after S.</summary>
    public static string StatusChangesTo(TicketStatus status) =>
        $"JOIN activity_entries a ON a.actor_id = s.user_id AND a.action = {Literal(UpdateTicket.FieldChanged)} AND a.field = 'status' AND a.occurred_at >= s.started_at"
        + $" AND a.new_value = '\"{status}\"'::jsonb";

    /// <summary>
    /// An alive ticket <c>t</c> (not deleted, in a project <c>p</c> that is not deleted; archived ones count) with the id
    /// <paramref name="ticketId"/>.
    /// </summary>
    public static string AliveTicket(string ticketId) =>
        $"JOIN tickets t ON t.id = {ticketId} AND t.deleted_at IS NULL JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL";

    /// <summary>A project <c>p</c> that is not deleted.</summary>
    public static string AliveProject(string projectId) => $"JOIN projects p ON p.id = {projectId} AND p.deleted_at IS NULL";

    /// <summary>
    /// For rows with a ticket id or a doc id (comments, attachments): <c>t</c> or <c>d</c> left-joined; combine with
    /// <see cref="TicketOrDocAlive"/> in the <c>WHERE</c> clause.
    /// </summary>
    public static string TicketOrDoc(string ticketId, string docId) =>
        $"LEFT JOIN tickets t ON t.id = {ticketId} LEFT JOIN doc_nodes d ON d.id = {docId}"
        + " JOIN projects p ON p.id = coalesce(t.project_id, d.project_id) AND p.deleted_at IS NULL";

    public const string TicketOrDocAlive = "((t.id IS NOT NULL AND t.deleted_at IS NULL) OR (d.id IS NOT NULL AND d.deleted_at IS NULL))";

    private static string Literal(string value) =>
        value.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-')
            ? $"'{value}'"
            : throw new ArgumentException($"'{value}' is not an action code.", nameof(value));
}
