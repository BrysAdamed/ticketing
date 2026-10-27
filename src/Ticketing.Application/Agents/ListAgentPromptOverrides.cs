using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>
/// A project that does not use the instance default for a ticket type: its own text (<c>Custom</c>) or no delegation
/// (<c>Off</c>). <see cref="DefaultChanged"/> is true for a Custom prompt written against an older default.
/// </summary>
public sealed record AgentPromptOverrideDto(
    string ProjectKey,
    string ProjectName,
    bool IsArchived,
    AgentPromptMode Mode,
    int Version,
    bool DefaultChanged,
    UserLookupDto? UpdatedBy,
    DateTimeOffset UpdatedAt);

/// <summary>
/// Admins in the web app: the live projects behind an instance default's override count, by project key. Guardrails cannot be
/// overridden, so that slot is <c>agent.prompt.notFound</c>.
/// </summary>
public static class ListAgentPromptOverrides
{
    public sealed record Query(string Slot);

    public sealed class Handler(ITicketingDbContext db, AgentPromptAccess agents, IProjectAccess access)
        : IHandler<Query, IReadOnlyList<AgentPromptOverrideDto>>
    {
        public async Task<IReadOnlyList<AgentPromptOverrideDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await agents.ReadAsync(null, request.Slot, cancellationToken);
            if (target.Slot.IsGuardrails)
                throw AppException.NotFound(AgentErrors.PromptNotFound, "Projects cannot override the guardrails; use a ticket type.");

            var type = target.Type;
            var defaultVersion = await db.AgentPromptTemplates
                .Where(t => t.Scope == AgentPromptScope.Instance && t.TicketType == type)
                .Select(t => t.CurrentVersion)
                .SingleAsync(cancellationToken);
            var rows = await db.AgentPromptTemplates
                .AsNoTracking()
                .Where(t => t.Scope == AgentPromptScope.Project && t.TicketType == type && t.Mode != AgentPromptMode.Inherit)
                .Join(access.ReadableProjects(), t => t.ProjectId, p => (Guid?)p.Id, (t, p) => new
                {
                    p.Key,
                    p.Name,
                    p.ArchivedAt,
                    t.Mode,
                    t.CurrentVersion,
                    t.BasedOnDefaultVersion,
                    t.UpdatedById,
                    t.UpdatedAt,
                })
                .OrderBy(r => r.Key)
                .ToListAsync(cancellationToken);
            var users = await AgentPromptQueries.UsersAsync(db, rows.Select(r => r.UpdatedById), cancellationToken);
            return [.. rows.Select(r => new AgentPromptOverrideDto(
                r.Key,
                r.Name,
                r.ArchivedAt is not null,
                r.Mode,
                r.CurrentVersion,
                r.Mode == AgentPromptMode.Custom && r.BasedOnDefaultVersion < defaultVersion,
                AgentPromptQueries.User(users, r.UpdatedById),
                r.UpdatedAt))];
        }
    }
}
