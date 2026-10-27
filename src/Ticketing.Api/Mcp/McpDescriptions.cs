namespace Ticketing.Api.Mcp;

/// <summary>Parameter description fragments shared by several tools.</summary>
internal static class McpDescriptions
{
    public const string Mentions =
        "Mention a user with @[Display Name](user:<user id>) or @email (for example @jane.doe@example.com; the server stores it as the first form). "
        + "A newly added mention notifies the user and makes them a watcher; it fails with mention.invalid unless the user is active and can read "
        + "the project (find_users with access 'read' lists them). Mentions inside code are ignored.";
}
