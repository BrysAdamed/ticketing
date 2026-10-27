using System.ComponentModel;
using ModelContextProtocol.Server;
using Ticketing.Application.Dashboard;

namespace Ticketing.Api.Mcp;

[McpServerToolType]
public sealed class DashboardTools
{
    [McpServerTool(Name = "get_project_stats", ReadOnly = true, Idempotent = true, Title = "Get project statistics")]
    [Description(
        "Project dashboard statistics (all widgets) as JSON. Deleted tickets are never counted; 'open' means status category is not Done. " +
        "totals (openTickets, doneTickets, openStoryPoints, unassignedOpenTickets); byStatus (all 8 statuses: ToDo, InProgress, OnHold, Review, " +
        "ReadyForTesting, Testing, ReadyForDeploy, Done, with category ToDo/InProgress/Done); byType (open, Epic/UserStory/Technical/Spike/Bug); " +
        "byPriority (open, Highest/High/Medium/Low/Lowest); openBugsBySeverity (Blocker/Critical/Major/Minor/Trivial, null = none); " +
        "createdVsResolved (12 ISO weeks, UTC, oldest first); openByAssignee (top 10 plus unassigned and others); stale (open, not updated for 30 days: " +
        "count and 10 oldest); epicProgress (open epics: direct children done/total by count and story points); testCases (non-archived per status " +
        "New/Manual/Automatic, automationRatio); regressions (latest non-cancelled session summary, pass rates of the last 5 completed sessions); " +
        "regressionBugs (open bugs created from regression items); recentDocs (total pages and diagrams, and the 5 most recently updated: key, " +
        "kind, title, path, version, updatedBy, updatedAt). The version filter applies to ticket-based widgets only.")]
    public static Task<ProjectDashboardDto> GetProjectStats(
        GetProjectDashboard.Handler handler,
        [Description("Project key (for example WEB) or project id.")] string projectKey,
        [Description("Optional exact ticket version (case-sensitive), for example 1.4.0. Omit for all versions.")] string? version = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetProjectDashboard.Query(projectKey, version), cancellationToken);
}
