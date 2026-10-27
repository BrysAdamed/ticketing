using Microsoft.AspNetCore.Http.Json;
using Scalar.AspNetCore;
using Ticketing.Api;
using Ticketing.Api.Auth;
using Ticketing.Api.DemoData;
using Ticketing.Api.Endpoints;
using Ticketing.Api.Health;
using Ticketing.Api.Http;
using Ticketing.Api.Mcp;
using Ticketing.Application;
using Ticketing.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddHostedService<DatabaseStartup>()
    .AddApplication()
    .AddInfrastructure(builder.Configuration)
    .AddDemoData(builder.Configuration)
    .AddTicketingForwardedHeaders(builder.Configuration)
    .AddTicketingAuth(builder.Configuration)
    .AddTicketingRateLimiting(builder.Configuration)
    .AddTicketingMcp()
    .AddTicketingHealthChecks()
    .AddOpenApi("v1", o => o.ConfigureTicketingSchemas())
    .AddProblemDetails(o => o.CustomizeProblemDetails = Problems.Customize)
    .AddExceptionHandler<ApiExceptionHandler>()
    .Configure<JsonOptions>(o => JsonSetup.Apply(o.SerializerOptions))
    .Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);

builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = RequestLimits.MaxBodyBytes);

var app = builder.Build();

if (DemoDataSetup.IsSeedCommand(args))
{
    await app.RunSeedCommandAsync();
    return;
}

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

var openApi = app.MapOpenApi("/api/{documentName}/openapi.json");
if (app.Environment.IsProduction())
{
    openApi.RequireAuthorization();
}
else
{
    openApi.AllowAnonymous();
    app.MapScalarApiReference("/scalar", o => o.WithOpenApiRoutePattern("/api/{documentName}/openapi.json")).AllowAnonymous();
}

app.MapTicketingHealth();
app.MapTicketingApi();
app.MapTicketingMcp();

await app.RunAsync();
