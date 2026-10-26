using Ticketing.Api.Http;

namespace Ticketing.Api.Endpoints;

public static class ApiEndpoints
{
    /// <summary>
    /// Maps <c>/api/v1</c>. Every route gets XSRF validation (cookie sessions) and the read-only PAT guard.
    /// A new feature adds exactly one line here: <c>api.Map&lt;Feature&gt;Endpoints();</c>.
    /// </summary>
    public static IEndpointRouteBuilder MapTicketingApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/v1")
            .AddEndpointFilter(Xsrf.ValidateAsync)
            .AddEndpointFilter(CredentialFilters.RejectReadOnlyTokenWritesAsync)
            .ProducesProblem(StatusCodes.Status401Unauthorized);

        api.MapAuthEndpoints();
        api.MapMeEndpoints();
        api.MapProjectEndpoints();
        return app;
    }
}
