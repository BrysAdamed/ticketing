using Ticketing.Api.Http;
using Ticketing.Application.Common;
using Ticketing.Application.Projects;
using Ticketing.Domain.Projects;

namespace Ticketing.Api.Endpoints;

/// <summary>
/// Reference endpoints. They only translate HTTP to a use case and back: route values, query strings and headers
/// (If-Match, Idempotency-Key) go into the command, the handler does the rest, and errors surface as exceptions.
/// Projects are addressed by key or id everywhere.
/// </summary>
public sealed class ProjectEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var projects = api.MapGroup("/projects").WithTags("Projects");

        projects.MapGet("", async (
                ListProjects.Handler handler, string? query, bool? includeArchived, ProjectVisibility? visibility, bool? mine, int? limit, string? cursor,
                CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(
                new ListProjects.Query(query, includeArchived ?? false, new PageRequest(limit, cursor), visibility, mine ?? false), ct)))
            .WithSummary("Projects the caller can read, ordered by key. Filters: query (key or name), visibility (Private, Public), mine (explicit member), includeArchived.");

        projects.MapGet("/{projectKeyOrId}", async (string projectKeyOrId, GetProject.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var project = await handler.HandleAsync(new GetProject.Query(projectKeyOrId), ct);
                response.SetRowVersion(project.RowVersion);
                return TypedResults.Ok(project);
            })
            .WithSummary("A project (by key or id) with its members and linked boards.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        projects.MapPost("", async (CreateProject.Command command, CreateProject.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var project = await handler.HandleAsync(command with { IdempotencyKey = request.IdempotencyKeyHeader() }, ct);
                request.HttpContext.Response.SetRowVersion(project.RowVersion);
                return TypedResults.Created($"/api/v1/projects/{project.Key}", project);
            })
            .WithSummary("Creates a project; the caller becomes its Owner. Accepts an Idempotency-Key header.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);

        projects.MapPatch("/{projectKeyOrId}", async (
                string projectKeyOrId, UpdateProject.Command command, UpdateProject.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var project = await handler.HandleAsync(
                    command with { ProjectKeyOrId = projectKeyOrId, ExpectedVersion = request.ExpectedRowVersion() }, ct);
                request.HttpContext.Response.SetRowVersion(project.RowVersion);
                return TypedResults.Ok(project);
            })
            .WithSummary("Updates name, description or visibility (Owner only). Send If-Match with the rowVersion to avoid lost updates.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        projects.MapPost("/{projectKeyOrId}/archive", async (string projectKeyOrId, ArchiveProject.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var project = await handler.HandleAsync(new ArchiveProject.Command(projectKeyOrId), ct);
                response.SetRowVersion(project.RowVersion);
                return TypedResults.Ok(project);
            })
            .WithSummary("Archives the project (Owner only): its board tickets return to the backlog top, it is unlinked from all boards and becomes read-only.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        projects.MapPost("/{projectKeyOrId}/unarchive", async (string projectKeyOrId, UnarchiveProject.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var project = await handler.HandleAsync(new UnarchiveProject.Command(projectKeyOrId), ct);
                response.SetRowVersion(project.RowVersion);
                return TypedResults.Ok(project);
            })
            .WithSummary("Unarchives the project (Owner only).")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        projects.MapDelete("/{projectKeyOrId}", async (string projectKeyOrId, string? confirmKey, DeleteProject.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new DeleteProject.Command(projectKeyOrId, confirmKey), ct);
                return TypedResults.NoContent();
            })
            .RequireCookieSession()
            .WithSummary("Soft-deletes an archived project (Admin only, web session only). confirmKey must equal the project key. The key stays reserved.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        var members = projects.MapGroup("/{projectKeyOrId}/members");

        members.MapGet("", async (string projectKeyOrId, ListProjectMembers.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListProjectMembers.Query(projectKeyOrId), ct)))
            .WithSummary("Members with their stored and effective roles, ordered by name.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        members.MapPost("", async (string projectKeyOrId, AddProjectMember.Command command, AddProjectMember.Handler handler, CancellationToken ct) =>
            {
                var member = await handler.HandleAsync(command with { ProjectKeyOrId = projectKeyOrId }, ct);
                return TypedResults.Created($"/api/v1/projects/{projectKeyOrId}/members/{member.UserId}", member);
            })
            .WithSummary("Adds an active user (email or id) with a role: Owner, Member or Viewer (Owner only).")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        members.MapPatch("/{userId:guid}", async (
                string projectKeyOrId, Guid userId, ChangeProjectMemberRole.Command command, ChangeProjectMemberRole.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command with { ProjectKeyOrId = projectKeyOrId, UserId = userId }, ct)))
            .WithSummary("Changes a member's role (Owner only). The project must keep an active Owner.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        members.MapDelete("/{userId:guid}", async (string projectKeyOrId, Guid userId, RemoveProjectMember.Handler handler, CancellationToken ct) =>
            {
                await handler.HandleAsync(new RemoveProjectMember.Command(projectKeyOrId, userId), ct);
                return TypedResults.NoContent();
            })
            .WithSummary("Removes a membership (Owner only). Assigned tickets stay assigned.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }
}
