using Ticketing.Application.Dashboard;

namespace Ticketing.Api.Endpoints;

public sealed class DashboardEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var dashboard = api.MapGroup("/projects/{projectKeyOrId}/dashboard").WithTags("Dashboard");

        dashboard.MapGet("", async (string projectKeyOrId, string? version, GetProjectDashboard.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetProjectDashboard.Query(projectKeyOrId, version), ct)))
            .WithSummary("All dashboard widgets of a project (spec 7). The optional version filters the ticket widgets.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
    }
}
