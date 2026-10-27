using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>
/// The prompt for a ticket (spec 13.5), in this order: the flag is on for the caller (404 <c>agent.disabled</c>); the ticket
/// is readable (404, or <c>ticket.deleted</c>) and its project not archived (<c>agent.unavailable</c>); the project has
/// delegation enabled (<c>agent.project.disabled</c>); the project's row for the ticket type is not Off
/// (<c>agent.type.off</c>), Custom uses its own body and Inherit or no row the instance default; then the guardrails are
/// appended when non-empty, and the result must stay below the deep-link limit (<c>agent.prompt.tooLong</c>).
/// Readers (Viewers and read-only tokens included) may resolve; nothing is written.
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
            if (ticket.Grant.IsArchived)
                throw AppException.Conflict(AgentErrors.Unavailable, $"Project {ticket.Grant.ProjectKey} is archived, so its tickets cannot be delegated.");

            var project = await db.Projects
                .AsNoTracking()
                .Where(p => p.Id == ticket.ProjectId)
                .Select(p => new { Facts = new AgentPromptProject(p.Key, p.RepositoryUrl, p.AgentMergePolicy), p.AgentDelegationEnabled })
                .SingleAsync(cancellationToken);
            if (!project.AgentDelegationEnabled)
                throw AppException.Conflict(
                    AgentErrors.ProjectDisabled, $"Agent delegation is off for project {ticket.Grant.ProjectKey}.", "A project Owner can turn it on in the project's Agent settings.");

            var type = await db.Tickets.Where(t => t.Id == ticket.Id).Select(t => t.Type).SingleAsync(cancellationToken);
            await defaults.EnsureAsync(cancellationToken);
            var instance = await AgentPromptQueries.InstanceAsync(db, cancellationToken);
            var row = await db.AgentPromptTemplates
                .AsNoTracking()
                .SingleOrDefaultAsync(t => t.Scope == AgentPromptScope.Project && t.ProjectId == ticket.ProjectId && t.TicketType == type, cancellationToken);
            if (row?.Mode == AgentPromptMode.Off)
                throw AppException.Conflict(AgentErrors.TypeOff, $"Project {ticket.Grant.ProjectKey} does not delegate {type} tickets to agents.");

            var (template, source) = row?.Mode == AgentPromptMode.Custom ? (row, AgentPromptSource.Custom) : (instance[new AgentPromptSlot(type)], AgentPromptSource.Default);
            var guardrails = instance[AgentPromptSlot.Guardrails];
            var context = composer.Context(project.Facts, ticket.Number, type, template.CurrentVersion, source);
            var prompt = composer.Compose(template.Body ?? string.Empty, guardrails.Body, context);
            if (!AgentPrompt.FitsLimit(prompt))
                throw AppException.Conflict(AgentErrors.PromptTooLong, AgentPrompt.TooLongMessage(prompt.Length), "Ask a project Owner or an Admin to shorten the template or the guardrails.");

            var users = await AgentPromptQueries.UsersAsync(db, [template.UpdatedById], cancellationToken);
            return new ResolvedAgentPromptDto(
                prompt,
                ticket.Key,
                type,
                new AgentPromptTemplateRefDto(source, template.CurrentVersion, template.UpdatedAt, AgentPromptQueries.User(users, template.UpdatedById)),
                guardrails.CurrentVersion);
        }
    }
}
