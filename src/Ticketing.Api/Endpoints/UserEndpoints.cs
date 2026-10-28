using Ticketing.Api.Http;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Users;

namespace Ticketing.Api.Endpoints;

/// <summary>User search for every signed-in user (pickers), and user administration for Admins in the web app (spec 5.2, 6.14).</summary>
public sealed class UserEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/users", async (
                FindUsers.Handler handler, string? query, string? projectKey, bool? includeInactive, int? limit, string? access, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(
                new FindUsers.Query(query, projectKey, includeInactive ?? false, limit, FindUsers.ParseAccess(access)), ct)))
            .WithTags("Users")
            .WithSummary("Up to 20 users whose email or a word of whose name starts with the query. With projectKey: active users who can write there, or with access=read who can read it (mentions).")
            .ProducesProblem(StatusCodes.Status404NotFound);

        api.MapGet("/users/avatars", async (ListUserAvatars.Handler handler, HttpContext http, CancellationToken ct) =>
                http.JsonWithContentETag(await handler.HandleAsync(new ListUserAvatars.Query(), ct)))
            .WithTags("Users")
            .WithSummary("Avatars of every user who picked one, deactivated users included, as [{ id, icon, color }]. Sends a content-hash ETag with Cache-Control: no-cache; If-None-Match answers 304.")
            .Produces<IReadOnlyList<UserAvatarDto>>()
            .Produces(StatusCodes.Status304NotModified);

        var users = api.MapGroup("/admin/users").WithTags("Admin: users").RequireCookieSession()
            .ProducesProblem(StatusCodes.Status403Forbidden);

        users.MapGet("", async (
                ListUsers.Handler handler, string? query, bool? isActive, GlobalRole? role, int? limit, string? cursor, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new ListUsers.Query(query, isActive, role, new PageRequest(limit, cursor)), ct)))
            .WithSummary("Users ordered by display name, with search and active/role filters.");

        users.MapGet("/{userId:guid}", async (Guid userId, GetUser.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var user = await handler.HandleAsync(new GetUser.Query(userId), ct);
                response.SetRowVersion(user.RowVersion);
                return TypedResults.Ok(user);
            })
            .WithSummary("A user.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        users.MapPost("", async (CreateUser.Command command, CreateUser.Handler handler, CancellationToken ct) =>
            {
                var result = await handler.HandleAsync(command, ct);
                return TypedResults.Created($"/api/v1/admin/users/{result.User.Id}", result);
            })
            .WithSummary("Creates a user and returns a one-time set-password link valid 72 hours. The Admin passes the link on.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);

        users.MapPatch("/{userId:guid}", async (
                Guid userId, UpdateUser.Command command, UpdateUser.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var user = await handler.HandleAsync(command with { UserId = userId, ExpectedVersion = request.ExpectedRowVersion() }, ct);
                request.HttpContext.Response.SetRowVersion(user.RowVersion);
                return TypedResults.Ok(user);
            })
            .WithSummary("Changes display name or global role. Demoting the last active Admin fails with user.lastAdmin.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        users.MapPost("/{userId:guid}/deactivate", async (Guid userId, DeactivateUser.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new DeactivateUser.Command(userId), ct)))
            .WithSummary("Deactivates a user: blocks login, ends sessions, revokes all tokens. Fails with user.lastAdmin or user.lastProjectOwner (errors.projects).")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        users.MapPost("/{userId:guid}/reactivate", async (Guid userId, ReactivateUser.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new ReactivateUser.Command(userId), ct)))
            .WithSummary("Reactivates a user. Revoked tokens stay revoked.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        users.MapPost("/{userId:guid}/set-password-link", async (Guid userId, IssueSetPasswordLink.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new IssueSetPasswordLink.Command(userId), ct)))
            .WithSummary("Issues a new set-password link valid 24 hours; earlier links stop working. The current password works until it is used.")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }
}
