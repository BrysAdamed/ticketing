using Ticketing.Api.Http;
using Ticketing.Application.Agents;

namespace Ticketing.Api.Endpoints;

/// <summary>
/// A project's agent setup and the resolved prompt of a ticket (spec 13.3, 13.5). Every route is a 404 <c>agent.disabled</c>
/// while the <c>agent.delegate</c> flag is off for the caller or <c>TICKETING_PUBLIC_URL</c> is unset.
/// </summary>
public sealed class AgentEndpoints : IEndpointModule
{
    public void MapEndpoints(RouteGroupBuilder api)
    {
        var setup = api.MapGroup("/projects/{projectKeyOrId}/agent").WithTags("Agent prompts");

        setup.MapGet("", async (string projectKeyOrId, GetProjectAgentSettings.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var settings = await handler.HandleAsync(new GetProjectAgentSettings.Query(projectKeyOrId), ct);
                response.SetRowVersion(settings.RowVersion);
                return TypedResults.Ok(settings);
            })
            .WithSummary("The project's agent setup: enabled, repository URL and its normalized form, default branch, merge policy and what Delegate does to the ticket.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        setup.MapPatch("", async (
                string projectKeyOrId, UpdateProjectAgentSettings.Command command, UpdateProjectAgentSettings.Handler handler, HttpRequest request, CancellationToken ct) =>
            {
                var settings = await handler.HandleAsync(command with { ProjectKeyOrId = projectKeyOrId, ExpectedVersion = request.ExpectedRowVersion() }, ct);
                request.HttpContext.Response.SetRowVersion(settings.RowVersion);
                return TypedResults.Ok(settings);
            })
            .WithSummary("Owners, web session only: changes the agent setup; omitted fields stay unchanged. Enabling needs a repository URL "
                + "(agent.project.repositoryRequired). Send If-Match with the project's rowVersion to avoid lost updates.")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        api.MapGet("/tickets/{ticketKeyOrId}/agent-prompt", async (string ticketKeyOrId, ResolveAgentPrompt.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new ResolveAgentPrompt.Query(ticketKeyOrId), ct)))
            .WithTags("Agent prompts")
            .WithSummary("The prompt Delegate to agent would start Claude Code with for this ticket (the same as MCP get_agent_prompt). Read access is enough; nothing is written.")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        api.MapPost("/tickets/{ticketKeyOrId}/agent-delegations", async (
                string ticketKeyOrId, RecordAgentDelegation.Command? command, RecordAgentDelegation.Handler handler, HttpResponse response, CancellationToken ct) =>
            {
                var ticket = await handler.HandleAsync((command ?? new RecordAgentDelegation.Command()) with { TicketKeyOrId = ticketKeyOrId }, ct);
                response.SetRowVersion(ticket.RowVersion);
                return TypedResults.Ok(ticket);
            })
            .WithTags("Agent prompts")
            .WithSummary("Web session only: records that the caller opened Claude on this ticket (`app`: ClaudeCode or ClaudeDesktop) and applies "
                + "the project's on-delegate settings (assign the caller if unassigned, To Do → In Progress). Returns the updated ticket.")
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }
}
