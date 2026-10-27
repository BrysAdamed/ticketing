using System.ComponentModel;
using ModelContextProtocol.Server;
using Ticketing.Application.Common;
using Ticketing.Application.Users;

namespace Ticketing.Api.Mcp;

/// <summary>User lookup for MCP clients (spec 9.3). User administration stays in the web app.</summary>
[McpServerToolType]
public sealed class UserTools
{
    [McpServerTool(Name = "find_users", ReadOnly = true, Idempotent = true, Title = "Find users")]
    [Description("Finds up to 20 users whose email, or a word of whose display name, starts with the query (case-insensitive). Returns { items, nextCursor } (nextCursor is always null) with id, email, displayName and isActive. Use the email to assign or mention a user. With projectKey, only active users who can write to that project are returned (assignable users), or with access 'read' those who can read it (users you can mention, viewers included).")]
    public static async Task<CursorPage<UserLookupDto>> FindUsers(
        FindUsers.Handler handler,
        [Description("Name or email prefix, for example 'jan' or 'jane.doe@'. Empty lists users alphabetically.")] string? query = null,
        [Description("Project key (for example WEB) or id: limit to users of that project.")] string? projectKey = null,
        [Description("With projectKey: 'Write' (default) for users who can edit the project, 'Read' for users who can read it (mentions).")] UserSearchAccess? access = null,
        CancellationToken cancellationToken = default) =>
        new(await handler.HandleAsync(
            new FindUsers.Query(query, projectKey, IncludeInactive: projectKey is null, Access: access ?? UserSearchAccess.Write), cancellationToken), null);
}
