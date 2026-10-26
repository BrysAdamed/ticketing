using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Api.Health;

internal static class HealthEndpoints
{
    private const string ReadyTag = "ready";

    public static IServiceCollection AddTicketingHealthChecks(this IServiceCollection services)
    {
        services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database", tags: [ReadyTag]);
        return services;
    }

    /// <summary><c>/health/live</c>: the process is up. <c>/health/ready</c>: it can reach PostgreSQL.</summary>
    public static IEndpointRouteBuilder MapTicketingHealth(this IEndpointRouteBuilder app)
    {
        app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
        app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = c => c.Tags.Contains(ReadyTag) }).AllowAnonymous();
        return app;
    }

    private sealed class DatabaseHealthCheck(TicketingDbContext db) : IHealthCheck
    {
        public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default) =>
            await db.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("PostgreSQL is not reachable.");
    }
}
