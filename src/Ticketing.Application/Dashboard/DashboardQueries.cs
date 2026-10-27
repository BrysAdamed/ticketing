using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Dashboard;

/// <summary>
/// The dashboard's read model: a handful of aggregate queries, each one index-friendly scan scoped to one project
/// (spec 7 performance target). Callers have already checked read access to <c>projectId</c>.
/// A null <c>version</c> means "all versions"; Postgres folds the <c>IS NULL</c> branch per execution.
/// </summary>
internal static class DashboardQueries
{
    public static Task<List<TicketGroupRow>> TicketGroupsAsync(
        ITicketingDbContext db, Guid projectId, string? version, DateTimeOffset staleBefore, CancellationToken ct) =>
        db.Database.SqlQuery<TicketGroupRow>($"""
            SELECT t.status, t.type, t.priority, t.severity,
                   t.assignee_id IS NULL AS unassigned,
                   t.updated_at < {staleBefore} AS stale,
                   count(*)::int AS count,
                   coalesce(sum(t.story_points), 0)::int AS story_points
            FROM tickets t
            WHERE t.project_id = {projectId} AND t.deleted_at IS NULL
              AND ({version}::varchar IS NULL OR t.version = {version})
            GROUP BY 1, 2, 3, 4, 5, 6
            """).ToListAsync(ct);

    public static Task<List<WeekRow>> WeeksAsync(ITicketingDbContext db, Guid projectId, string? version, DateTimeOffset from, CancellationToken ct) =>
        db.Database.SqlQuery<WeekRow>($"""
            SELECT w.week_start, sum(w.created)::int AS created, sum(w.resolved)::int AS resolved
            FROM (
                SELECT (date_trunc('week', t.created_at, 'UTC') AT TIME ZONE 'UTC')::date AS week_start, 1 AS created, 0 AS resolved
                FROM tickets t
                WHERE t.project_id = {projectId} AND t.deleted_at IS NULL AND t.created_at >= {from}
                  AND ({version}::varchar IS NULL OR t.version = {version})
                UNION ALL
                SELECT (date_trunc('week', t.resolved_at, 'UTC') AT TIME ZONE 'UTC')::date, 0, 1
                FROM tickets t
                WHERE t.project_id = {projectId} AND t.deleted_at IS NULL AND t.resolved_at >= {from}
                  AND ({version}::varchar IS NULL OR t.version = {version})
            ) AS w
            GROUP BY w.week_start
            """).ToListAsync(ct);

    public static Task<List<AssigneeRow>> TopAssigneesAsync(ITicketingDbContext db, Guid projectId, string? version, int limit, CancellationToken ct) =>
        db.Database.SqlQuery<AssigneeRow>($"""
            SELECT u.id, u.email, u.display_name, u.is_active, a.count
            FROM (
                SELECT t.assignee_id, count(*)::int AS count
                FROM tickets t
                WHERE t.project_id = {projectId} AND t.deleted_at IS NULL AND t.status <> {(int)TicketStatus.Done}
                  AND t.assignee_id IS NOT NULL
                  AND ({version}::varchar IS NULL OR t.version = {version})
                GROUP BY t.assignee_id
            ) AS a
            JOIN users u ON u.id = a.assignee_id
            ORDER BY a.count DESC, u.display_name, u.id
            LIMIT {limit}
            """).ToListAsync(ct);

    public static Task<List<TicketRow>> StaleTicketsAsync(
        ITicketingDbContext db, Guid projectId, string? version, DateTimeOffset staleBefore, int limit, CancellationToken ct) =>
        db.Database.SqlQuery<TicketRow>($"""
            SELECT t.number, t.title, t.type, t.status, t.priority, t.severity, t.updated_at,
                   u.id AS assignee_id, u.email AS assignee_email, u.display_name AS assignee_name, u.is_active AS assignee_active,
                   0 AS total
            FROM tickets t
            LEFT JOIN users u ON u.id = t.assignee_id
            WHERE t.project_id = {projectId} AND t.deleted_at IS NULL AND t.status <> {(int)TicketStatus.Done}
              AND t.updated_at < {staleBefore}
              AND ({version}::varchar IS NULL OR t.version = {version})
            ORDER BY t.updated_at, t.number
            LIMIT {limit}
            """).ToListAsync(ct);

    /// <summary>
    /// Picks the first open epics (by priority, then number) through the project/type index, then aggregates each one's
    /// direct children through the parent index. With a version filter an epic qualifies when it or a child has that version.
    /// </summary>
    public static Task<List<EpicRow>> EpicsAsync(ITicketingDbContext db, Guid projectId, string? version, int limit, CancellationToken ct) =>
        db.Database.SqlQuery<EpicRow>($"""
            WITH epics AS (
                SELECT e.id, e.number, e.title, e.status, e.priority, (count(*) OVER ())::int AS total
                FROM tickets e
                WHERE e.project_id = {projectId} AND e.deleted_at IS NULL
                  AND e.type = {(int)TicketType.Epic} AND e.status <> {(int)TicketStatus.Done}
                  AND ({version}::varchar IS NULL OR e.version = {version} OR EXISTS (
                      SELECT 1 FROM tickets v WHERE v.project_id = {projectId} AND v.parent_id = e.id AND v.deleted_at IS NULL AND v.version = {version}))
                ORDER BY e.priority, e.number
                LIMIT {limit}
            )
            SELECT e.number, e.title, e.status, e.priority, c.children_total, c.children_done, c.points_total, c.points_done, e.total
            FROM epics e
            CROSS JOIN LATERAL (
                SELECT (count(*) FILTER (WHERE ch.in_scope))::int AS children_total,
                       (count(*) FILTER (WHERE ch.in_scope AND ch.status = {(int)TicketStatus.Done}))::int AS children_done,
                       coalesce(sum(ch.story_points) FILTER (WHERE ch.in_scope), 0)::int AS points_total,
                       coalesce(sum(ch.story_points) FILTER (WHERE ch.in_scope AND ch.status = {(int)TicketStatus.Done}), 0)::int AS points_done
                FROM (
                    SELECT t.status, t.story_points, ({version}::varchar IS NULL OR t.version = {version}) AS in_scope
                    FROM tickets t
                    WHERE t.parent_id = e.id AND t.deleted_at IS NULL
                ) AS ch
            ) AS c
            ORDER BY e.priority, e.number
            """).ToListAsync(ct);

    public static Task<List<TestCaseRow>> TestCasesAsync(ITicketingDbContext db, Guid projectId, CancellationToken ct) =>
        db.Database.SqlQuery<TestCaseRow>($"""
            SELECT c.status, count(*)::int AS count
            FROM test_cases c
            WHERE c.project_id = {projectId} AND c.archived_at IS NULL
            GROUP BY c.status
            """).ToListAsync(ct);

    public static Task<List<SessionRow>> SessionsAsync(ITicketingDbContext db, Guid projectId, int recentCompleted, CancellationToken ct) =>
        db.Database.SqlQuery<SessionRow>($"""
            WITH picked AS (
                (SELECT s.id FROM regression_sessions s
                 WHERE s.project_id = {projectId} AND s.status <> {(int)RegressionSessionStatus.Cancelled}
                 ORDER BY s.started_at DESC, s.number DESC LIMIT 1)
                UNION
                (SELECT s.id FROM regression_sessions s
                 WHERE s.project_id = {projectId} AND s.status = {(int)RegressionSessionStatus.Completed}
                 ORDER BY s.completed_at DESC, s.number DESC LIMIT {recentCompleted})
            )
            SELECT s.number, s.name, s.version, s.status, s.started_at, s.completed_at,
                   count(i.id)::int AS total,
                   (count(i.id) FILTER (WHERE i.status = {(int)RegressionItemStatus.Passed} AND i.execution_mode = {(int)ExecutionMode.Manual}))::int AS passed_manual,
                   (count(i.id) FILTER (WHERE i.status = {(int)RegressionItemStatus.Passed} AND i.execution_mode = {(int)ExecutionMode.Automatic}))::int AS passed_automatic,
                   (count(i.id) FILTER (WHERE i.status = {(int)RegressionItemStatus.Failed}))::int AS failed,
                   (count(i.id) FILTER (WHERE i.status = {(int)RegressionItemStatus.Skipped}))::int AS skipped,
                   (count(i.id) FILTER (WHERE i.status = {(int)RegressionItemStatus.WaitingForExecution}))::int AS waiting,
                   count(i.bug_ticket_id)::int AS bugs_created
            FROM regression_sessions s
            JOIN picked p ON p.id = s.id
            LEFT JOIN regression_session_items i ON i.session_id = s.id
            GROUP BY s.id
            """).ToListAsync(ct);

    /// <summary>Open bugs created from a regression item of any session (a cancelled session's bug is still real work).</summary>
    public static Task<List<TicketRow>> RegressionBugsAsync(ITicketingDbContext db, Guid projectId, string? version, int limit, CancellationToken ct) =>
        db.Database.SqlQuery<TicketRow>($"""
            SELECT t.number, t.title, t.type, t.status, t.priority, t.severity, t.updated_at,
                   u.id AS assignee_id, u.email AS assignee_email, u.display_name AS assignee_name, u.is_active AS assignee_active,
                   (count(*) OVER ())::int AS total
            FROM tickets t
            LEFT JOIN users u ON u.id = t.assignee_id
            WHERE t.project_id = {projectId} AND t.deleted_at IS NULL AND t.status <> {(int)TicketStatus.Done}
              AND ({version}::varchar IS NULL OR t.version = {version})
              AND EXISTS (SELECT 1 FROM regression_session_items i WHERE i.bug_ticket_id = t.id)
            ORDER BY t.priority, t.severity NULLS LAST, t.number
            LIMIT {limit}
            """).ToListAsync(ct);
}

internal sealed record TicketGroupRow(
    TicketStatus Status, TicketType Type, Priority Priority, Severity? Severity, bool Unassigned, bool Stale, int Count, int StoryPoints);

internal sealed record WeekRow(DateOnly WeekStart, int Created, int Resolved);

internal sealed record AssigneeRow(Guid Id, string Email, string DisplayName, bool IsActive, int Count);

internal sealed record TicketRow(
    int Number,
    string Title,
    TicketType Type,
    TicketStatus Status,
    Priority Priority,
    Severity? Severity,
    DateTimeOffset UpdatedAt,
    Guid? AssigneeId,
    string? AssigneeEmail,
    string? AssigneeName,
    bool? AssigneeActive,
    int Total);

internal sealed record EpicRow(
    int Number, string Title, TicketStatus Status, Priority Priority,
    int ChildrenTotal, int ChildrenDone, int PointsTotal, int PointsDone, int Total);

internal sealed record TestCaseRow(TestCaseStatus Status, int Count);

internal sealed record SessionRow(
    int Number,
    string Name,
    string? Version,
    RegressionSessionStatus Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    int Total,
    int PassedManual,
    int PassedAutomatic,
    int Failed,
    int Skipped,
    int Waiting,
    int BugsCreated);
