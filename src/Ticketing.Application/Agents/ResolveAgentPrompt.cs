using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Agents;

/// <summary>
/// The prompt for a ticket (spec 13.5), in this order: the flag is on for the caller (404 <c>agent.disabled</c>); the ticket
/// is readable (404, or <c>ticket.deleted</c>) and its project not archived (<c>agent.unavailable</c>); the project has
/// delegation enabled (<c>agent.project.disabled</c>); the project's row for the ticket type is not Off
/// (<c>agent.type.off</c>), Custom uses its own body and Inherit or no row the instance default; both it and the guardrails
/// must still parse (<c>agent.template.invalid</c>); then the guardrails are appended when non-empty, and the result must
/// stay below the deep-link limit (<c>agent.prompt.tooLong</c>). The result names the newest outsider text the agent will
/// read (<see cref="AgentOutsiderContent"/>). Readers (Viewers and read-only tokens included) may resolve; nothing is written.
/// </summary>
public static class ResolveAgentPrompt
{
    public sealed record Query(string TicketKeyOrId);

    public sealed class Handler(
        ITicketingDbContext db, AgentGate gate, IProjectAccess access, AgentPromptDefaults defaults, AgentPromptComposer composer)
        : IHandler<Query, ResolvedAgentPromptDto>
    {
        public async Task<ResolvedAgentPromptDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            await gate.EnsureEnabledAsync(cancellationToken);
            var ticket = await TicketLookup.ReadAsync(db, access, request.TicketKeyOrId, cancellationToken);
            return await ResolveAsync(ticket, cancellationToken);
        }

        /// <summary>The resolution checks and the prompt for a ticket the caller can already read; the gate is the caller's job.</summary>
        public async Task<ResolvedAgentPromptDto> ResolveAsync(TicketTarget ticket, CancellationToken cancellationToken)
        {
            if (ticket.Grant.IsArchived)
                throw AppException.Conflict(AgentErrors.Unavailable, $"Project {ticket.Grant.ProjectKey} is archived, so its tickets cannot be delegated.");

            var project = await db.Projects
                .AsNoTracking()
                .Where(p => p.Id == ticket.ProjectId)
                .Select(p => new { Facts = new AgentPromptProject(p.Key, p.RepositoryUrl, p.DefaultBranch, p.AgentMergePolicy), p.AgentDelegationEnabled })
                .SingleAsync(cancellationToken);
            if (!project.AgentDelegationEnabled)
                throw AppException.Conflict(
                    AgentErrors.ProjectDisabled, $"Agent delegation is off for project {ticket.Grant.ProjectKey}.", "A project Owner can turn it on in the project's Agent settings.");

            var facts = await db.Tickets.Where(t => t.Id == ticket.Id).Select(t => new { t.Type, t.ParentId }).SingleAsync(cancellationToken);
            var type = facts.Type;
            await defaults.EnsureAsync(cancellationToken);
            var instance = await AgentPromptQueries.InstanceAsync(db, cancellationToken);
            var row = await db.AgentPromptTemplates
                .AsNoTracking()
                .SingleOrDefaultAsync(t => t.Scope == AgentPromptScope.Project && t.ProjectId == ticket.ProjectId && t.TicketType == type, cancellationToken);
            if (row?.Mode == AgentPromptMode.Off)
                throw AppException.Conflict(AgentErrors.TypeOff, $"Project {ticket.Grant.ProjectKey} does not delegate {type} tickets to agents.");

            var (template, source) = row?.Mode == AgentPromptMode.Custom ? (row, AgentPromptSource.Custom) : (instance[new AgentPromptSlot(type)], AgentPromptSource.Default);
            var guardrails = instance[AgentPromptSlot.Guardrails];
            EnsureStoredTemplatesParse(template, source, guardrails, ticket.Grant.ProjectKey, type);
            var context = composer.Context(project.Facts, ticket.Number, type, template.CurrentVersion, source);
            var prompt = composer.Compose(template.Body ?? string.Empty, guardrails.Body, context);
            if (!AgentPrompt.FitsLimit(prompt))
                throw AppException.Conflict(AgentErrors.PromptTooLong, AgentPrompt.TooLongMessage(prompt.Length), "Ask a project Owner or an Admin to shorten the template or the guardrails.");

            var outsider = await AgentOutsiderContent.FindAsync(db, access, ticket, facts.ParentId, cancellationToken);
            var users = await AgentPromptQueries.UsersAsync(db, [template.UpdatedById, outsider?.AuthorId], cancellationToken);
            return new ResolvedAgentPromptDto(
                prompt,
                ticket.Key,
                type,
                new AgentPromptTemplateRefDto(source, template.CurrentVersion, template.UpdatedAt, AgentPromptQueries.User(users, template.UpdatedById)),
                guardrails.CurrentVersion,
                outsider is null
                    ? null
                    : new AgentPromptOutsiderContentDto(outsider.Source, AgentPromptQueries.User(users, outsider.AuthorId), outsider.At, outsider.ProjectKey, outsider.ItemKey));
        }

        /// <summary>
        /// A stored template was valid when saved but may stop parsing later, for example when a release removes a
        /// placeholder. That is a state problem, not a bad request: 409 <c>agent.template.invalid</c> naming where to fix it,
        /// with the position of the first error but never the body.
        /// </summary>
        private static void EnsureStoredTemplatesParse(
            AgentPromptTemplate template, AgentPromptSource source, AgentPromptTemplate guardrails, string projectKey, TicketType type)
        {
            if (AgentPromptComposer.FirstError(template.Body) is { } typeError)
                throw source == AgentPromptSource.Custom
                    ? InvalidTemplate($"Project {projectKey}'s {type} agent prompt template", typeError, "A project Owner can fix it in the project's Agent settings.")
                    : InvalidTemplate($"The default {type} agent prompt template", typeError, "An Admin can fix it in Admin → Agent prompts.");
            if (AgentPromptComposer.FirstError(guardrails.Body) is { } guardrailsError)
                throw InvalidTemplate("The agent guardrails", guardrailsError, "An Admin can fix them in Admin → Agent prompts.");
        }

        private static AppException InvalidTemplate(string what, PromptTemplateError error, string hint) =>
            AppException.Conflict(
                AgentErrors.TemplateInvalid, $"{what} no longer parses (line {error.Line}, column {error.Column}: {error.Code}).", hint);
    }
}
