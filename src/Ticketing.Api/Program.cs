using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Json;
using Scalar.AspNetCore;
using Ticketing.Api;
using Ticketing.Api.Auth;
using Ticketing.Api.Endpoints;
using Ticketing.Api.Health;
using Ticketing.Api.Http;
using Ticketing.Api.Mcp;
using Ticketing.Application;
using Ticketing.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration)
    .AddHostedService<DatabaseStartup>()
    .AddTicketingAuth(builder.Configuration)
    .AddPatRateLimiting(builder.Configuration)
    .AddTicketingMcp()
    .AddTicketingHealthChecks()
    .AddOpenApi("v1")
    .AddProblemDetails(o => o.CustomizeProblemDetails = Problems.Customize)
    .AddExceptionHandler<ApiExceptionHandler>()
    .Configure<JsonOptions>(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(allowIntegerValues: false)))
    .Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

app.MapOpenApi("/api/{documentName}/openapi.json").AllowAnonymous();
if (!app.Environment.IsProduction())
    app.MapScalarApiReference("/scalar", o => o.WithOpenApiRoutePattern("/api/{documentName}/openapi.json")).AllowAnonymous();

app.MapTicketingHealth();
app.MapTicketingApi();
app.MapTicketingMcp();

await app.RunAsync();
