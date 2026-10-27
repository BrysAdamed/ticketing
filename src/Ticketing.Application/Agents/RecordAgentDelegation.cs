using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Agents;

/// <summary>
/// Records that the caller opened Claude on a ticket from the web app (refinement §6, D-100). Order: the agent gate
/// (404 <c>agent.disabled</c>), the web session (<c>auth.cookieSessionRequired</c>), the ticket (404 for outsiders), an
/// archived project (<c>agent.unavailable</c>), write access, the prompt resolution checks, and a Done ticket
/// (<c>agent.ticket.done</c>). Then, in one transaction and with one timestamp: the <c>ticket.agent.delegated</c> entry,
/// the caller as assignee when the project assigns on delegate and nobody is assigned, and To Do → In Progress when the
/// project starts progress on delegate. The entry holds template and guardrails versions and the app, never the prompt
/// or the local folder.
/// </summary>
public static class RecordAgentDelegation
{
    public const string Action = "ticket.agent.delegated";

    public sealed record Command
    {
        [JsonIgnore]
        public string TicketKeyOrId { get; init; } = string.Empty;

        public AgentApp App { get; init; } = AgentApp.ClaudeCode;
    }

    /// <summary>The <c>NewValue</c> of a <c>ticket.agent.delegated</c> entry.</summary>
    public sealed record DelegatedValue(AgentPromptSource TemplateSource, int TemplateVersion, int GuardrailsVersion, AgentApp App);

    public sealed class Handler(
        ITicketingDbContext db,
        AgentGate gate,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        ResolveAgentPrompt.Handler resolver) : IHandler<Command, TicketDto>
    {
        public async Task<TicketDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            await gate.EnsureEnabledAsync(cancellationToken);
            currentUser.EnsureCookieSession();
            var readable = await TicketLookup.ReadAsync(db, access, command.TicketKeyOrId, cancellationToken);
            if (readable.Grant.IsArchived)
                throw AppException.Conflict(AgentErrors.Unavailable, $"Project {readable.Grant.ProjectKey} is archived, so its tickets cannot be delegated.");
            var target = readable with { Grant = await access.EnsureCanWriteAsync(readable.ProjectId, cancellationToken) };
            var resolved = await resolver.ResolveAsync(target, cancellationToken);
            var settings = await db.Projects
                .AsNoTracking()
                .Where(p => p.Id == target.ProjectId)
                .Select(p => new { p.AgentAssignOnDelegate, p.AgentStartProgressOnDelegate })
                .SingleAsync(cancellationToken);
            var assignee = settings.AgentAssignOnDelegate
                ? await TicketUsers.AssigneeAsync(db, currentUser, target.Grant, TicketUsers.Me, cancellationToken)
                : (Guid?)null;

            await db.InTransactionAsync(async ct =>
            {
                var ticket = await db.Tickets.SingleAsync(t => t.Id == target.Id, ct);
                if (ticket.Status == TicketStatus.Done)
                    throw AppException.Conflict(AgentErrors.TicketDone, $"{target.Key} is done.", "Reopen the ticket to delegate it.");

                var now = clock.Now;
                activity.Record(
                    ActivityEntityType.Ticket, ticket.Id, target.ProjectId, Action,
                    new DelegatedValue(resolved.Template.Source, resolved.Template.Version, resolved.GuardrailsVersion, command.App));
                if (assignee is { } userId && ticket.AssigneeId is null)
                {
                    ticket.AssignTo(userId);
                    activity.RecordChange(ActivityEntityType.Ticket, ticket.Id, target.ProjectId, UpdateTicket.FieldChanged, "assignee", (Guid?)null, (Guid?)userId);
                }
                if (settings.AgentStartProgressOnDelegate && ticket.Status == TicketStatus.ToDo)
                {
                    ticket.ChangeStatus(TicketStatus.InProgress, null, now);
                    activity.RecordChange(ActivityEntityType.Ticket, ticket.Id, target.ProjectId, UpdateTicket.FieldChanged, "status", TicketStatus.ToDo, TicketStatus.InProgress);
                }
                ticket.Touch(now);
                await db.SaveChangesAsync(ct);
                return true;
            }, cancellationToken);

            return await GetTicket.Handler.LoadAsync(db, access, currentUser, target, TicketIncludes.None, cancellationToken);
        }
    }
}
