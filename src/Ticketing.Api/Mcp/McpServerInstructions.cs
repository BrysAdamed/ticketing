namespace Ticketing.Api.Mcp;

/// <summary>
/// The primer every MCP client receives on <c>initialize</c> (spec 9.1, 14.8). It costs agent context on every
/// connection, so keep it short. <c>docs/mcp.md</c> mirrors it verbatim; a test keeps the two equal.
/// </summary>
public static class McpServerInstructions
{
    public const string Text =
        """
        Ticketing is the team's issue tracker. Every call runs as the user who owns your access token, with their permissions.

        - Call `whoami` first: it returns who you act as, their global role and your token scope (a ReadOnly token cannot write).
        - Keys: tickets `WEB-42`, test cases `WEB-TC-7`, regression sessions `WEB-R-3`, docs `WEB-D-12`. Project keys never change; refer to things by key.
        - Statuses: ToDo, InProgress, OnHold, Review, ReadyForTesting, Testing, ReadyForDeploy, Done. Transitions are free: set any status from any status with `update_ticket`; there is no workflow to follow.
        - Backlog vs boards: a ticket lives in exactly one place, its project's backlog or one board. New tickets land in the backlog; `move_ticket` moves them between the backlog and boards (a board's columns are the statuses).
        - Not found can mean no access: private projects you cannot read, and everything in them, answer not found exactly like keys that do not exist.
        - Retries: create tools take `idempotencyKey`; repeating a call with the same key within 24 hours returns the original result instead of a duplicate. `update_ticket` takes `expectedVersion` to avoid overwriting someone else's change.
        - Errors come back as `{ code, message, hint }`; the hint says how to fix the call. Tool descriptions list the allowed values of every enum.
        - More: docs/mcp.md in the Ticketing repository, and Help → Connect an AI agent in the web app.
        """;
}
