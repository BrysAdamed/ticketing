using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Users;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Agents;

/// <summary>Loading templates and shaping them into DTOs, shared by the template use cases.</summary>
internal static class AgentPromptQueries
{
    public static IQueryable<AgentPromptTemplate> For(ITicketingDbContext db, AgentPromptTarget target)
    {
        var type = target.Slot.Type;
        if (target.Project is { } project)
        {
            var projectId = project.ProjectId;
            return db.AgentPromptTemplates.Where(t => t.Scope == AgentPromptScope.Project && t.ProjectId == projectId && t.TicketType == type);
        }
        return db.AgentPromptTemplates.Where(t => t.Scope == AgentPromptScope.Instance && t.TicketType == type);
    }

    /// <summary>The six instance rows by slot. <see cref="AgentPromptDefaults.EnsureAsync"/> must have run in this request.</summary>
    public static async Task<IReadOnlyDictionary<AgentPromptSlot, AgentPromptTemplate>> InstanceAsync(ITicketingDbContext db, CancellationToken cancellationToken)
    {
        var rows = await db.AgentPromptTemplates.AsNoTracking().Where(t => t.Scope == AgentPromptScope.Instance).ToListAsync(cancellationToken);
        var bySlot = rows.ToDictionary(t => t.Slot);
        if (AgentPromptSlot.Instance.Any(s => !bySlot.ContainsKey(s)))
            throw new InvalidOperationException("Instance agent prompts are missing; AgentPromptDefaults.EnsureAsync did not run.");
        return bySlot;
    }

    public static async Task<IReadOnlyDictionary<Guid, UserLookupDto>> UsersAsync(ITicketingDbContext db, IEnumerable<Guid?> ids, CancellationToken cancellationToken)
    {
        var wanted = ids.OfType<Guid>().Distinct().ToList();
        if (wanted.Count == 0)
            return new Dictionary<Guid, UserLookupDto>();
        return await db.Users
            .AsNoTracking()
            .Where(u => wanted.Contains(u.Id))
            .Select(u => new UserLookupDto(u.Id, u.Email, u.DisplayName, u.IsActive))
            .ToDictionaryAsync(u => u.Id, cancellationToken);
    }

    public static UserLookupDto? User(IReadOnlyDictionary<Guid, UserLookupDto> users, Guid? id) => id is { } value ? users.GetValueOrDefault(value) : null;

    public static async Task<ProjectAgentPromptDto> ProjectDtoAsync(ITicketingDbContext db, Guid projectId, TicketType type, CancellationToken cancellationToken)
    {
        var instance = await InstanceAsync(db, cancellationToken);
        var row = await db.AgentPromptTemplates
            .AsNoTracking()
            .SingleOrDefaultAsync(t => t.Scope == AgentPromptScope.Project && t.ProjectId == projectId && t.TicketType == type, cancellationToken);
        var users = await UsersAsync(db, [row?.UpdatedById], cancellationToken);
        var defaults = instance[new AgentPromptSlot(type)];
        var guardrails = instance[AgentPromptSlot.Guardrails];
        var summary = ProjectSummary(type, row, defaults, users);
        return new ProjectAgentPromptDto(
            type,
            summary.Mode,
            summary.Version,
            row?.Mode == AgentPromptMode.Custom ? row.Body : null,
            summary.EffectiveSource,
            summary.EffectiveVersion,
            summary.EffectiveSource switch
            {
                AgentPromptSource.Custom => row!.Body,
                AgentPromptSource.Default => defaults.Body,
                _ => null,
            },
            defaults.CurrentVersion,
            defaults.Body ?? string.Empty,
            row?.BasedOnDefaultVersion,
            summary.DefaultChanged,
            guardrails.CurrentVersion,
            guardrails.Body,
            summary.UpdatedBy,
            summary.UpdatedAt);
    }

    public static ProjectAgentPromptSummaryDto ProjectSummary(
        TicketType type, AgentPromptTemplate? row, AgentPromptTemplate defaults, IReadOnlyDictionary<Guid, UserLookupDto> users)
    {
        var mode = row?.Mode ?? AgentPromptMode.Inherit;
        var (source, version) = mode switch
        {
            AgentPromptMode.Custom => ((AgentPromptSource?)AgentPromptSource.Custom, (int?)row!.CurrentVersion),
            AgentPromptMode.Off => (null, null),
            _ => (AgentPromptSource.Default, defaults.CurrentVersion),
        };
        return new ProjectAgentPromptSummaryDto(
            type,
            mode,
            row?.CurrentVersion ?? 0,
            source,
            version,
            defaults.CurrentVersion,
            mode == AgentPromptMode.Custom && row!.BasedOnDefaultVersion < defaults.CurrentVersion,
            User(users, row?.UpdatedById),
            row?.UpdatedAt);
    }

    public static async Task<InstanceAgentPromptDto> InstanceDtoAsync(
        ITicketingDbContext db, IBuiltInAgentPrompts builtIns, AgentPromptSlot slot, CancellationToken cancellationToken)
    {
        var row = (await InstanceAsync(db, cancellationToken))[slot];
        var overriding = await OverridingCountsAsync(db, cancellationToken);
        var users = await UsersAsync(db, [row.UpdatedById], cancellationToken);
        var summary = InstanceSummary(row, builtIns, overriding, users);
        return new InstanceAgentPromptDto(
            summary.Slot, summary.Type, summary.Version, row.Body, summary.BuiltInVersion, summary.FollowsBuiltIn, summary.LatestBuiltInVersion,
            summary.NewerBuiltInAvailable, builtIns.For(slot).Body, summary.OverridingProjects, summary.UpdatedBy, summary.UpdatedAt);
    }

    public static InstanceAgentPromptSummaryDto InstanceSummary(
        AgentPromptTemplate row, IBuiltInAgentPrompts builtIns, IReadOnlyDictionary<TicketType, int> overriding, IReadOnlyDictionary<Guid, UserLookupDto> users) =>
        new(
            row.Slot.Name,
            row.TicketType,
            row.CurrentVersion,
            row.BuiltInVersion,
            row.FollowsBuiltIn,
            builtIns.Version,
            row.NewerBuiltInAvailable(builtIns.For(row.Slot)),
            row.TicketType is { } type ? overriding.GetValueOrDefault(type) : 0,
            User(users, row.UpdatedById),
            row.UpdatedAt);

    /// <summary>Per ticket type, how many live projects override the instance default (Custom or Off).</summary>
    public static async Task<IReadOnlyDictionary<TicketType, int>> OverridingCountsAsync(ITicketingDbContext db, CancellationToken cancellationToken)
    {
        var counts = await db.AgentPromptTemplates
            .AsNoTracking()
            .Where(t => t.Scope == AgentPromptScope.Project && t.Mode != AgentPromptMode.Inherit && t.TicketType != null)
            .Where(t => db.Projects.Any(p => p.Id == t.ProjectId && p.DeletedAt == null))
            .GroupBy(t => t.TicketType!.Value)
            .Select(g => new { Type = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return counts.ToDictionary(c => c.Type, c => c.Count);
    }

    public static IQueryable<AgentPromptVersionSummaryDto> VersionSummaries(ITicketingDbContext db, Guid templateId) =>
        db.AgentPromptTemplateVersions
            .AsNoTracking()
            .Where(v => v.TemplateId == templateId)
            .OrderByDescending(v => v.Number)
            .Select(v => new AgentPromptVersionSummaryDto(
                v.Number,
                v.Mode,
                v.BuiltInVersion,
                v.ChangeNote,
                db.Users.Where(u => u.Id == v.AuthorId).Select(u => new UserLookupDto(u.Id, u.Email, u.DisplayName, u.IsActive)).FirstOrDefault(),
                v.CreatedAt,
                v.RestoredFrom));
}
