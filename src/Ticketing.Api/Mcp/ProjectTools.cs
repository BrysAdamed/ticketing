using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.Projects;
using Ticketing.Domain.Projects;

namespace Ticketing.Api.Mcp;

/// <summary>
/// Reference MCP tools. Like the REST endpoints they only translate arguments into a use case: handlers are injected
/// as tool parameters, errors propagate as exceptions and become <c>{ code, message, hint }</c> tool errors.
/// Write tools carry <c>[Authorize(Policy = AuthPolicies.CanWrite)]</c>, which hides them from read-only tokens.
/// </summary>
[McpServerToolType]
public sealed class ProjectTools
{
    [McpServerTool(Name = "list_projects", ReadOnly = true, Idempotent = true, Title = "List projects")]
    [Description("Lists projects you can read, ordered by key: key, name, visibility, your effective role (Owner, Member, Viewer) and open ticket count. Returns { items, nextCursor }.")]
    public static Task<CursorPage<ProjectSummaryDto>> ListProjects(
        ListProjects.Handler handler,
        [Description("Filter by key or name (case-insensitive substring).")] string? query = null,
        [Description("Include archived projects. Default false.")] bool includeArchived = false,
        [Description("Page size 1..100, default 25.")] int? limit = null,
        [Description("nextCursor from the previous page.")] string? cursor = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new ListProjects.Query(query, includeArchived, new PageRequest(limit, cursor)), cancellationToken);

    [McpServerTool(Name = "get_project", ReadOnly = true, Idempotent = true, Title = "Get project")]
    [Description("Gets a project by key (for example WEB): fields, members with roles, linked boards and the current version.")]
    public static Task<ProjectDto> GetProject(
        GetProject.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetProject.Query(projectKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "create_project", Destructive = false, Title = "Create project")]
    [Description("Creates a project; you become its Owner. Visibility is Private (default) or Public; public projects are writable by every signed-in user.")]
    public static Task<ProjectDto> CreateProject(
        CreateProject.Handler handler,
        [Description("Unique, immutable key: 2-10 upper-case letters or digits starting with a letter, for example WEB.")] string key,
        [Description("Project name, unique among active projects, at most 100 characters.")] string name,
        [Description("Markdown description, at most 10000 characters.")] string? description = null,
        [Description("Private or Public. Default Private.")] ProjectVisibility? visibility = null,
        [Description("Optional key that makes retries safe: a repeat within 24 hours returns the original result.")] string? idempotencyKey = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new CreateProject.Command(key, name, description, visibility, idempotencyKey), cancellationToken);
}
