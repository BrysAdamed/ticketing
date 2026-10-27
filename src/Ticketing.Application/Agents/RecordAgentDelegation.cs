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
/// Records that the caller opened Claude on a ticket from the web app (refinement §6, D-100, D-105). Order: the agent gate
/// (404 <c>agent.disabled</c>), the web session (<c>auth.cookieSessionRequired</c>), the ticket (404 for outsiders), an
/// archived project (<c>agent.unavailable</c>), write access, the prompt resolution checks, and a Done ticket
/// (<c>agent.ticket.done</c>). Then, in one transaction and with one timestamp: the <c>ticket.agent.delegated</c> entry,
/// the caller as assignee when the project assigns on delegate and nobody is assigned, and To Do → In Progress when the
/// project starts progress on delegate. The entry holds the launched template and guardrails versions and the app, never
/// the prompt or the local folder. When the request says what it launched, the entry keeps those versions, adds the
/// current ones when they differ, and a resolution check that fails now no longer refuses the record but marks the prompt
/// as since withdrawn, because the launch has already happened.
/// </summary>
public static class RecordAgentDelegation
{
    public const string Action = "ticket.agent.delegated";

    private static readonly HashSet<string> Withdrawals =
        [AgentErrors.ProjectDisabled, AgentErrors.TypeOff, AgentErrors.TemplateInvalid, AgentErrors.PromptTooLong];

    public sealed record Command
    {
        [JsonIgnore]
        public string TicketKeyOrId { get; init; } = string.Empty;

        public AgentApp App { get; init; } = AgentApp.ClaudeCode;

        /// <summary>The versions of the prompt the client launched, from the resolved prompt it loaded.</summary>
        public AgentPromptVersions? Launched { get; init; }
    }

    /// <summary>The template and guardrails versions a prompt was resolved from.</summary>
    public sealed record AgentPromptVersions(AgentPromptSource TemplateSource, int TemplateVersion, int GuardrailsVersion)
    {
        public static AgentPromptVersions Of(ResolvedAgentPromptDto resolved) =>
            new(resolved.Template.Source, resolved.Template.Version, resolved.GuardrailsVersion);
    }

    /// <summary>
    /// The <c>NewValue</c> of a <c>ticket.agent.delegated</c> entry: the launched versions, the <see cref="Current"/> ones
    /// when they differ, and the error code that <see cref="Withdrawn"/> the prompt since it was loaded.
    /// </summary>
    public sealed record DelegatedValue(
        AgentPromptSource TemplateSource,
        int TemplateVersion,
        int GuardrailsVersion,
        AgentApp App,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] AgentPromptVersions? Current = null,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Withdrawn = null);

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
            EnsureValid(command.Launched);
            var readable = await TicketLookup.ReadAsync(db, access, command.TicketKeyOrId, cancellationToken);
            if (readable.Grant.IsArchived)
                throw AppException.Conflict(AgentErrors.Unavailable, $"Project {readable.Grant.ProjectKey} is archived, so its tickets cannot be delegated.");
            var target = readable with { Grant = await access.EnsureCanWriteAsync(readable.ProjectId, cancellationToken) };
            var value = await DelegatedValueAsync(target, command, cancellationToken);
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
                activity.Record(ActivityEntityType.Ticket, ticket.Id, target.ProjectId, Action, value);
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

        private async Task<DelegatedValue> DelegatedValueAsync(TicketTarget target, Command command, CancellationToken cancellationToken)
        {
            AgentPromptVersions current;
            try
            {
                current = AgentPromptVersions.Of(await resolver.ResolveAsync(target, cancellationToken));
            }
            catch (AppException ex) when (command.Launched is { } withdrawnPrompt && Withdrawals.Contains(ex.Code))
            {
                return Value(withdrawnPrompt, command.App, withdrawn: ex.Code);
            }
            var launched = command.Launched ?? current;
            return Value(launched, command.App, current: launched == current ? null : current);
        }

        private static DelegatedValue Value(AgentPromptVersions launched, AgentApp app, AgentPromptVersions? current = null, string? withdrawn = null) =>
            new(launched.TemplateSource, launched.TemplateVersion, launched.GuardrailsVersion, app, current, withdrawn);

        private static void EnsureValid(AgentPromptVersions? launched)
        {
            if (launched is null)
                return;
            if (!Enum.IsDefined(launched.TemplateSource))
                throw AppException.Invalid("launched.templateSource", "Send Default or Custom.");
            if (launched.TemplateVersion < 1)
                throw AppException.Invalid("launched.templateVersion", "A template version starts at 1.");
            if (launched.GuardrailsVersion < 1)
                throw AppException.Invalid("launched.guardrailsVersion", "A guardrails version starts at 1.");
        }
    }
}
