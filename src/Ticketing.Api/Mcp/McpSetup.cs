using System.Text.Json;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Api.Http;

namespace Ticketing.Api.Mcp;

/// <summary>
/// The MCP server at <c>/mcp</c>: Streamable HTTP, stateless, PAT-only. Tools live in this folder, one class per feature,
/// and call the same application handlers as the REST endpoints.
/// </summary>
internal static class McpSetup
{
    public static readonly JsonSerializerOptions Json = CreateJsonOptions();

    public static IServiceCollection AddTicketingMcp(this IServiceCollection services)
    {
        services
            .AddMcpServer(o => o.ServerInfo = new Implementation { Name = "ticketing", Version = ServerVersion.Current })
            .WithHttpTransport(o => o.Stateless = true)
            .AddAuthorizationFilters()
            .WithToolsFromAssembly(typeof(McpSetup).Assembly, Json)
            .WithRequestFilters(filters => filters
                .AddListToolsFilter(next => async (context, cancellationToken) =>
                    await FeatureGatedTools.FilterAsync(await next(context, cancellationToken), context.Services!, cancellationToken))
                .AddCallToolFilter(next => async (context, cancellationToken) =>
                {
                    try
                    {
                        return await next(context, cancellationToken);
                    }
                    catch (Exception ex) when (Problems.ToAppException(ex) is { } error)
                    {
                        return McpErrors.ToResult(error);
                    }
                }));
        return services;
    }

    public static IEndpointRouteBuilder MapTicketingMcp(this IEndpointRouteBuilder app)
    {
        app.MapMcp("/mcp").RequireAuthorization(AuthPolicies.Mcp);
        return app;
    }

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions(McpJsonUtilities.DefaultOptions);
        JsonSetup.Apply(options);
        options.MakeReadOnly();
        return options;
    }
}

internal static class ServerVersion
{
    public static readonly string Current =
        typeof(ServerVersion).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
}
