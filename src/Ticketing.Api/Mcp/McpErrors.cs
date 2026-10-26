using System.Text.Json;
using System.Text.Json.Nodes;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Common;

namespace Ticketing.Api.Mcp;

/// <summary>Turns application errors into MCP tool errors: <c>isError: true</c> with <c>{ code, message, hint }</c> (spec 9.2).</summary>
internal static class McpErrors
{
    public static CallToolResult ToResult(AppException error)
    {
        var payload = new JsonObject
        {
            ["code"] = error.Code,
            ["message"] = error.Message,
            ["hint"] = error.Hint,
        };
        if (error.Errors.Count > 0)
            payload["errors"] = JsonSerializer.SerializeToNode(error.Errors);

        return new CallToolResult
        {
            IsError = true,
            Content = [new TextContentBlock { Text = payload.ToJsonString() }],
            StructuredContent = JsonSerializer.SerializeToElement(payload),
        };
    }
}
