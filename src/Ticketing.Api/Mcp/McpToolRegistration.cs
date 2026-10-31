using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.AI;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using Ticketing.Application.Common;

namespace Ticketing.Api.Mcp;

/// <summary>
/// Registers every <see cref="McpServerToolTypeAttribute"/> tool of this assembly like <c>WithToolsFromAssembly</c>, and gives
/// <see cref="Optional{T}"/> parameters the JSON schema of their inner type (nullable when null clears the field). Without it
/// they have no type at all, and clients send an explicit null as the string "null".
/// </summary>
internal static class McpToolRegistration
{
    private const BindingFlags ToolMethods = BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;

    public static IMcpServerBuilder WithTicketingTools(this IMcpServerBuilder builder, JsonSerializerOptions json)
    {
        var tools = typeof(McpToolRegistration).Assembly.GetTypes()
            .Where(t => t.GetCustomAttribute<McpServerToolTypeAttribute>() is not null)
            .SelectMany(t => t.GetMethods(ToolMethods).Select(m => (Type: t, Method: m)))
            .Where(t => t.Method.GetCustomAttribute<McpServerToolAttribute>() is not null);
        foreach (var (type, method) in tools)
            builder.Services.AddSingleton(services => DescribeOptionalParameters(CreateTool(type, method, services, json), method, json));
        return builder;
    }

    private static McpServerTool CreateTool(Type type, MethodInfo method, IServiceProvider services, JsonSerializerOptions json)
    {
        var options = new McpServerToolCreateOptions { Services = services, SerializerOptions = json };
        return method.IsStatic
            ? McpServerTool.Create(method, (object?)null, options)
            : McpServerTool.Create(method, (RequestContext<CallToolRequestParams> r) => ActivatorUtilities.CreateInstance(r.Services!, type), options);
    }

    private static McpServerTool DescribeOptionalParameters(McpServerTool tool, MethodInfo method, JsonSerializerOptions json)
    {
        var optional = method.GetParameters()
            .Where(p => p.ParameterType.IsGenericType && p.ParameterType.GetGenericTypeDefinition() == typeof(Optional<>))
            .ToList();
        if (optional.Count == 0)
            return tool;

        var schema = JsonNode.Parse(tool.ProtocolTool.InputSchema.GetRawText())!.AsObject();
        if (schema["properties"] is not JsonObject properties)
            return tool;
        var nullability = new NullabilityInfoContext();
        foreach (var parameter in optional)
        {
            if (parameter.Name is not { } name || properties[name] is not JsonObject property)
                continue;
            var inner = parameter.ParameterType.GetGenericArguments()[0];
            var innerSchema = AIJsonUtilities.CreateJsonSchema(inner, serializerOptions: json);
            foreach (var (keyword, value) in JsonNode.Parse(innerSchema.GetRawText())!.AsObject())
            {
                if (!property.ContainsKey(keyword))
                    property[keyword] = value?.DeepClone();
            }
            if (!inner.IsValueType && nullability.Create(parameter).GenericTypeArguments[0].ReadState == NullabilityState.Nullable)
                AllowNull(property);
        }
        tool.ProtocolTool.InputSchema = JsonSerializer.SerializeToElement(schema, McpJsonUtilities.DefaultOptions);
        return tool;
    }

    private static void AllowNull(JsonObject property)
    {
        if (property["type"] is JsonValue type && type.TryGetValue<string>(out var single))
            property["type"] = new JsonArray(single, "null");
        else if (property["type"] is JsonArray types && !types.Any(t => t?.GetValue<string>() == "null"))
            types.Add("null");
    }
}
