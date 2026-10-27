using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>
/// Keeps the six instance rows (five ticket types and the guardrails) in line with the built-ins: creates missing rows and
/// upgrades rows that still carry a verbatim built-in when a newer release ships. Rows an Admin edited are never touched.
/// Runs at startup and before every agent prompt use case; it is a cheap read when nothing is due, idempotent, and safe
/// when several requests or instances run it at once.
/// </summary>
public sealed class AgentPromptDefaults(ITicketingDbContext db, IBuiltInAgentPrompts builtIns, IClock clock)
{
    public const string UpdatedAction = "agent.prompt.updated";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    public async Task EnsureAsync(CancellationToken cancellationToken)
    {
        var rows = await db.AgentPromptTemplates
            .AsNoTracking()
            .Where(t => t.Scope == AgentPromptScope.Instance)
            .Select(t => new { t.TicketType, t.FollowsBuiltIn, t.BuiltInVersion })
            .ToListAsync(cancellationToken);
        var missing = AgentPromptSlot.Instance.Where(s => rows.All(r => r.TicketType != s.Type)).ToList();
        var due = rows.Any(r => r.FollowsBuiltIn && builtIns.For(new AgentPromptSlot(r.TicketType)).IsNewerThan(r.BuiltInVersion));
        if (missing.Count == 0 && !due)
            return;

        try
        {
            var now = clock.Now;
            foreach (var slot in missing)
            {
                var (template, version) = AgentPromptTemplate.CreateInstance(builtIns.For(slot), now);
                db.AgentPromptTemplates.Add(template);
                db.AgentPromptTemplateVersions.Add(version);
            }
            if (due)
                await UpgradeAsync(now, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex is DbUpdateConcurrencyException || ex.IsUniqueViolation())
        {
            db.ChangeTracker.Clear();
        }
    }

    /// <summary>The activity value of <c>agent.prompt.updated</c>: the version and mode, never the body (spec 13.8).</summary>
    public static object ActivityValue(int version, AgentPromptMode mode) => new { version, mode };

    private async Task UpgradeAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        var following = await db.AgentPromptTemplates
            .Where(t => t.Scope == AgentPromptScope.Instance && t.FollowsBuiltIn)
            .ToListAsync(cancellationToken);
        foreach (var template in following)
        {
            var before = ActivityValue(template.CurrentVersion, template.Mode);
            var version = template.UpgradeToBuiltIn(builtIns.For(template.Slot), now);
            if (version is null)
                continue;
            db.AgentPromptTemplateVersions.Add(version);
            db.ActivityEntries.Add(ActivityEntry.Create(
                ActivityEntityType.AgentPrompt, template.Id, null, actorId: null, channel: null, now, UpdatedAction, template.Slot.Name,
                JsonSerializer.Serialize(before, Json), JsonSerializer.Serialize(ActivityValue(template.CurrentVersion, template.Mode), Json)));
        }
    }
}
