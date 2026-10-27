using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

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

            var outsider = await OutsiderContentAsync(ticket, cancellationToken);
            var users = await AgentPromptQueries.UsersAsync(db, [template.UpdatedById, outsider?.AuthorId], cancellationToken);
            return new ResolvedAgentPromptDto(
                prompt,
                ticket.Key,
                type,
                new AgentPromptTemplateRefDto(source, template.CurrentVersion, template.UpdatedAt, AgentPromptQueries.User(users, template.UpdatedById)),
                guardrails.CurrentVersion,
                outsider is null ? null : new AgentPromptOutsiderContentDto(outsider.Source, AgentPromptQueries.User(users, outsider.AuthorId), outsider.At));
        }

        /// <summary>
        /// On a public project, the latest of the current description's last write and the latest comment whose author is
        /// neither a member of the project nor an Admin (D-100); null on private projects or when both came from insiders.
        /// </summary>
        private async Task<OutsiderContent?> OutsiderContentAsync(TicketTarget ticket, CancellationToken cancellationToken)
        {
            if (ticket.Grant.Visibility != ProjectVisibility.Public)
                return null;

            var description = await db.ActivityEntries
                .AsNoTracking()
                .Where(a => a.EntityType == ActivityEntityType.Ticket && a.EntityId == ticket.Id
                    && (a.Action == CreateTicket.Action || (a.Action == UpdateTicket.FieldChanged && a.Field == "description")))
                .OrderByDescending(a => a.OccurredAt)
                .Select(a => new { a.ActorId, a.OccurredAt })
                .FirstOrDefaultAsync(cancellationToken);
            var comment = await db.Comments
                .AsNoTracking()
                .Where(c => c.TicketId == ticket.Id && c.DeletedAt == null)
                .OrderByDescending(c => c.CreatedAt)
                .Select(c => new { c.AuthorId, c.CreatedAt })
                .FirstOrDefaultAsync(cancellationToken);

            var candidates = new List<OutsiderContent>(2);
            if (description?.ActorId is { } describer)
                candidates.Add(new OutsiderContent(AgentPromptContentSource.Description, describer, description.OccurredAt));
            if (comment is not null)
                candidates.Add(new OutsiderContent(AgentPromptContentSource.Comment, comment.AuthorId, comment.CreatedAt));
            if (candidates.Count == 0)
                return null;

            var authors = candidates.Select(c => c.AuthorId).Distinct().ToList();
            var insiders = await db.Users
                .AsNoTracking()
                .Where(u => authors.Contains(u.Id)
                    && (u.GlobalRole == GlobalRole.Admin || db.ProjectMembers.Any(m => m.ProjectId == ticket.ProjectId && m.UserId == u.Id)))
                .Select(u => u.Id)
                .ToListAsync(cancellationToken);
            return candidates.Where(c => !insiders.Contains(c.AuthorId)).OrderByDescending(c => c.At).FirstOrDefault();
        }

        private sealed record OutsiderContent(AgentPromptContentSource Source, Guid AuthorId, DateTimeOffset At);
    }
}
