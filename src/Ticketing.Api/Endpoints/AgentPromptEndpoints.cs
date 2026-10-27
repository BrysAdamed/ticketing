using Ticketing.Application.Agents;

namespace Ticketing.Api.Endpoints;

/// <summary>
/// Agent prompt templates (spec 13.7): project overrides per ticket type and the instance defaults and guardrails. Every
/// route is a 404 <c>agent.disabled</c> while the <c>agent.delegate</c> flag is off for the caller. Writes and previews need
/// the web session (<c>auth.cookieSessionRequired</c> for a PAT); the handlers check it after the flag, so the feature stays
/// invisible.
/// </summary>
public sealed class AgentPromptEndpoints : IEndpointModule
{
    private const string VersionsSummary = "The version history, newest first, without bodies.";
    private const string VersionSummary = "One version with its body.";
    private const string RestoreSummary = "makes version n current again as a new version. Send the current version as baseVersion.";
    private const string PreviewSummary = "Renders body for ticketKey or a sample ticket, with the guardrails, and stores nothing; template errors come back in errors with line and column.";

    public void MapEndpoints(RouteGroupBuilder api)
    {
        MapProject(api.MapGroup("/projects/{projectKeyOrId}/agent/prompts").WithTags("Agent prompts"));
        MapInstance(api.MapGroup("/admin/agent/prompts").WithTags("Admin: agent prompts"));

        api.MapGet("/admin/agent/status", async (GetAgentInstanceStatus.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetAgentInstanceStatus.Query(), ct)))
            .WithTags("Admin: agent prompts")
            .WithSummary("Admins: whether TICKETING_PUBLIC_URL is set and delegation is available. Needs only the agent.delegate flag, "
                + "so it answers while the URL is unset and every other agent route is agent.disabled.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        api.MapGet("/agent/prompt-placeholders", async (ListAgentPromptPlaceholders.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListAgentPromptPlaceholders.Query(), ct)))
            .WithTags("Agent prompts")
            .WithSummary("The placeholders a prompt template may use. No ticket title, description or comment: the agent reads those over MCP.")
            .ProducesProblem(StatusCodes.Status404NotFound);
    }

    private static void MapProject(RouteGroupBuilder prompts)
    {
        prompts.MapGet("", async (string projectKeyOrId, ListProjectAgentPrompts.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListProjectAgentPrompts.Query(projectKeyOrId), ct)))
            .WithSummary("The five ticket types with their mode (Inherit, Custom, Off), effective source and version, and whether the default changed since a custom prompt was written.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        prompts.MapGet("/{type}", async (string projectKeyOrId, string type, GetProjectAgentPrompt.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetProjectAgentPrompt.Query(projectKeyOrId, type), ct)))
            .WithSummary("One ticket type: the project's own body, the effective body, the instance default and the guardrails.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        prompts.MapPut("/{type}", async (string projectKeyOrId, string type, SaveProjectAgentPrompt.Command command, SaveProjectAgentPrompt.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command with { ProjectKeyOrId = projectKeyOrId, Type = type }, ct)))
            .WithSummary("Owners: sets the mode and body as a new version. baseVersion is the version you edited (0 if the type never left Inherit); a stale one fails with agent.prompt.versionConflict.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        prompts.MapPost("/{type}/reset", async (string projectKeyOrId, string type, ResetProjectAgentPrompt.Command command, ResetProjectAgentPrompt.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command with { ProjectKeyOrId = projectKeyOrId, Type = type }, ct)))
            .WithSummary("Owners: back to the instance default (Inherit) as a new version; the custom text stays in the history.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        prompts.MapGet("/{type}/versions", async (string projectKeyOrId, string type, ListAgentPromptVersions.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListAgentPromptVersions.Query(projectKeyOrId, type), ct)))
            .WithSummary(VersionsSummary)
            .ProducesProblem(StatusCodes.Status404NotFound);

        prompts.MapGet("/{type}/versions/{number:int}", async (string projectKeyOrId, string type, int number, GetAgentPromptVersion.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetAgentPromptVersion.Query(projectKeyOrId, type, number), ct)))
            .WithSummary(VersionSummary)
            .ProducesProblem(StatusCodes.Status404NotFound);

        prompts.MapPost("/{type}/versions/{number:int}/restore", async (
                string projectKeyOrId, string type, int number, RestoreAgentPromptVersion.Command command, RestoreAgentPromptVersion.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command with { ProjectKeyOrId = projectKeyOrId, Slot = type, Number = number }, ct)))
            .WithSummary("Owners: " + RestoreSummary)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        prompts.MapPost("/{type}/preview", async (string projectKeyOrId, string type, PreviewAgentPrompt.Command command, PreviewAgentPrompt.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command with { ProjectKeyOrId = projectKeyOrId, Slot = type }, ct)))
            .WithSummary(PreviewSummary + " A null body previews the instance default. ticketKey must be in this project.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);
    }

    private static void MapInstance(RouteGroupBuilder prompts)
    {
        prompts.MapGet("", async (ListInstanceAgentPrompts.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListInstanceAgentPrompts.Query(), ct)))
            .WithSummary("Admins: the five instance defaults and the guardrails, with built-in status and how many projects override each type.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        prompts.MapGet("/{slot}", async (string slot, GetInstanceAgentPrompt.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetInstanceAgentPrompt.Query(slot), ct)))
            .WithSummary("Admins: one slot (a ticket type or guardrails) with its body and the latest built-in.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        prompts.MapGet("/{slot}/overrides", async (string slot, ListAgentPromptOverrides.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListAgentPromptOverrides.Query(slot), ct)))
            .WithSummary("Admins: the projects that override this ticket type's default (Custom or Off), by project key. Not for guardrails.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        prompts.MapPut("/{slot}", async (string slot, SaveInstanceAgentPrompt.Command command, SaveInstanceAgentPrompt.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command with { Slot = slot }, ct)))
            .WithSummary("Admins: saves the body as a new version (an empty guardrails body removes the guardrails). A stale baseVersion fails with agent.prompt.versionConflict.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        prompts.MapPost("/{slot}/reset-built-in", async (string slot, ResetInstanceAgentPromptToBuiltIn.Command command, ResetInstanceAgentPromptToBuiltIn.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command with { Slot = slot }, ct)))
            .WithSummary("Admins: takes the shipped built-in as a new version; the slot then follows later built-ins automatically.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        prompts.MapGet("/{slot}/versions", async (string slot, ListAgentPromptVersions.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ListAgentPromptVersions.Query(null, slot), ct)))
            .WithSummary(VersionsSummary)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        prompts.MapGet("/{slot}/versions/{number:int}", async (string slot, int number, GetAgentPromptVersion.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetAgentPromptVersion.Query(null, slot, number), ct)))
            .WithSummary(VersionSummary)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        prompts.MapPost("/{slot}/versions/{number:int}/restore", async (
                string slot, int number, RestoreAgentPromptVersion.Command command, RestoreAgentPromptVersion.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command with { ProjectKeyOrId = null, Slot = slot, Number = number }, ct)))
            .WithSummary("Admins: " + RestoreSummary)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        prompts.MapPost("/{slot}/preview", async (string slot, PreviewAgentPrompt.Command command, PreviewAgentPrompt.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(command with { ProjectKeyOrId = null, Slot = slot }, ct)))
            .WithSummary(PreviewSummary + " A null body previews the stored text; the guardrails render after a sample ticket's default.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);
    }
}
