using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Agents;

/// <summary>A template slot the caller may act on: a project's ticket type (with the caller's grant) or an instance slot.</summary>
public sealed record AgentPromptTarget(AgentPromptSlot Slot, ProjectAccessGrant? Project)
{
    public TicketType Type => Slot.Type ?? throw new InvalidOperationException("The guardrails slot has no ticket type.");
}

/// <summary>
/// The access rules of every template use case (spec 13.6), in order: the flag (404 <c>agent.disabled</c>), then for writes
/// the cookie session (<c>auth.cookieSessionRequired</c>, so an agent's PAT cannot rewrite its own prompts), then the project
/// (read: 404 for outsiders; write: Owner or Admin, not archived) or, for instance slots, an Admin in the web app. Finally the
/// instance defaults are brought in line with the built-ins.
/// </summary>
public sealed class AgentPromptAccess(AgentGate gate, IProjectAccess access, ICurrentUser currentUser, AgentPromptDefaults defaults)
{
    public async Task<ProjectAccessGrant> ReadProjectAsync(string projectKeyOrId, CancellationToken cancellationToken)
    {
        await gate.EnsureEnabledAsync(cancellationToken);
        var grant = await access.EnsureCanReadAsync(projectKeyOrId, cancellationToken);
        await defaults.EnsureAsync(cancellationToken);
        return grant;
    }

    public async Task EnsureAdminAsync(CancellationToken cancellationToken)
    {
        await gate.EnsureEnabledAsync(cancellationToken);
        currentUser.EnsureAdminWebSession();
        await defaults.EnsureAsync(cancellationToken);
    }

    /// <param name="projectKeyOrId">The project, or null for an instance slot (Admins in the web app only).</param>
    public async Task<AgentPromptTarget> ReadAsync(string? projectKeyOrId, string? slot, CancellationToken cancellationToken)
    {
        await gate.EnsureEnabledAsync(cancellationToken);
        ProjectAccessGrant? grant = null;
        if (projectKeyOrId is null)
            currentUser.EnsureAdminWebSession();
        else
            grant = await access.EnsureCanReadAsync(projectKeyOrId, cancellationToken);
        var target = new AgentPromptTarget(ParseSlot(slot, allowGuardrails: grant is null), grant);
        await defaults.EnsureAsync(cancellationToken);
        return target;
    }

    public async Task<AgentPromptTarget> WriteAsync(string? projectKeyOrId, string? slot, CancellationToken cancellationToken)
    {
        await gate.EnsureEnabledAsync(cancellationToken);
        currentUser.EnsureCookieSession();
        ProjectAccessGrant? grant = null;
        if (projectKeyOrId is null)
            currentUser.EnsureAdmin();
        else
            grant = await access.EnsureOwnerAsync(projectKeyOrId, cancellationToken);
        var target = new AgentPromptTarget(ParseSlot(slot, allowGuardrails: grant is null), grant);
        await defaults.EnsureAsync(cancellationToken);
        return target;
    }

    private static AgentPromptSlot ParseSlot(string? value, bool allowGuardrails)
    {
        if (AgentPromptSlot.TryParse(value, out var slot) && (allowGuardrails || !slot.IsGuardrails))
            return slot;
        var expected = allowGuardrails ? "a ticket type or Guardrails" : "a ticket type";
        throw AppException.NotFound(AgentErrors.PromptNotFound, $"Prompt '{value}' was not found; use {expected}.");
    }
}
