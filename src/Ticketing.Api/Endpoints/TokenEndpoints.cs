using Ticketing.Api.Http;
using Ticketing.Application.Common;
using Ticketing.Application.Tokens;
using Ticketing.Domain.Tokens;

namespace Ticketing.Api.Endpoints;

/// <summary>Personal access tokens: own tokens for everyone, all tokens for Admins. Web session only (spec 5.5).</summary>
public sealed class TokenEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var mine = api.MapGroup("/me/tokens").WithTags("Access tokens").RequireCookieSession()
            .ProducesProblem(StatusCodes.Status403Forbidden);

        mine.MapGet("", async (ListMyTokens.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new ListMyTokens.Query(), ct)))
            .WithSummary("Your tokens, newest first, including revoked and expired ones from the last 90 days.");

        mine.MapPost("", async (CreateMyToken.Command command, CreateMyToken.Handler handler, CancellationToken ct) =>
            {
                var created = await handler.HandleAsync(command, ct);
                return TypedResults.Created($"/api/v1/me/tokens/{created.Token.Id}", created);
            })
            .WithSummary("Creates a token. Expiry: expiresInDays (7, 30, 90, 365; default 90) or expiresAt (at most 365 days). The secret is returned only here.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);

        mine.MapPost("/{tokenId:guid}/revoke", async (Guid tokenId, RevokeToken.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new RevokeToken.Command(tokenId), ct)))
            .WithSummary("Revokes one of your tokens immediately.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        var all = api.MapGroup("/admin/tokens").WithTags("Admin: access tokens").RequireCookieSession()
            .ProducesProblem(StatusCodes.Status403Forbidden);

        all.MapGet("", async (ListTokens.Handler handler, Guid? userId, PatStatus? status, int? limit, string? cursor, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new ListTokens.Query(userId, status, new PageRequest(limit, cursor)), ct)))
            .WithSummary("Every user's tokens (never secrets), newest first.");

        all.MapPost("/{tokenId:guid}/revoke", async (Guid tokenId, RevokeToken.Handler handler, CancellationToken ct) =>
            TypedResults.Ok(await handler.HandleAsync(new RevokeToken.Command(tokenId, AsAdmin: true), ct)))
            .WithSummary("Revokes any user's token.")
            .ProducesProblem(StatusCodes.Status404NotFound);
    }
}
