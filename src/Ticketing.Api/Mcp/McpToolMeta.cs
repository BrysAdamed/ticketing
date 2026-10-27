namespace Ticketing.Api.Mcp;

/// <summary>Keys of the tool <c>_meta</c> entries MCP clients act on.</summary>
internal static class McpToolMeta
{
    /// <summary>
    /// Asks clients that honour it (Claude Code) to confirm every call with the user, even when the session would otherwise run
    /// it without asking. Every destructive tool carries it (D-102).
    /// </summary>
    public const string RequiresUserInteraction = "anthropic/requiresUserInteraction";
}
