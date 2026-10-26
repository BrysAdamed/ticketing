using Ticketing.Api.Http;
using Ticketing.Application.Audit;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;

namespace Ticketing.Api.Endpoints;

public sealed class AuditEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api) =>
        api.MapGet("/admin/audit", async (
                ListAuditEntries.Handler handler,
                Guid? actorId,
                ActivityEntityType? entityType,
                Guid? entityId,
                string? action,
                DateTimeOffset? from,
                DateTimeOffset? to,
                int? limit,
                string? cursor,
                CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(
                new ListAuditEntries.Query(actorId, entityType, entityId, action, from, to, new PageRequest(limit, cursor)), ct)))
            .WithTags("Admin: audit")
            .RequireCookieSession()
            .WithSummary("Admin audit trail for users, tokens, flags and projects, newest first. action matches exactly, or as a prefix when it ends with '.'.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden);
}
