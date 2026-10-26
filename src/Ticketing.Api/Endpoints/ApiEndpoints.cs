using Ticketing.Api.Http;

namespace Ticketing.Api.Endpoints;

/// <summary>A feature's REST endpoints under <c>/api/v1</c>. Implementations are discovered automatically; adding one touches no shared file.</summary>
public interface IEndpointModule
{
    void MapEndpoints(RouteGroupBuilder api);
}

public static class ApiEndpoints
{
    /// <summary>Maps <c>/api/v1</c> with XSRF validation (cookie sessions) and the read-only PAT guard, then every <see cref="IEndpointModule"/>.</summary>
    public static IEndpointRouteBuilder MapTicketingApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/v1")
            .AddEndpointFilter(Xsrf.ValidateAsync)
            .AddEndpointFilter(CredentialFilters.RejectReadOnlyTokenWritesAsync)
            .ProducesProblem(StatusCodes.Status401Unauthorized);

        var modules = typeof(ApiEndpoints).Assembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(IEndpointModule).IsAssignableFrom(t))
            .OrderBy(t => t.FullName, StringComparer.Ordinal);
        foreach (var module in modules)
            ((IEndpointModule)Activator.CreateInstance(module)!).MapEndpoints(api);
        return app;
    }
}
