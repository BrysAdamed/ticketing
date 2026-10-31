using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.FeatureFlags;

namespace Ticketing.Application.FeatureFlags;

/// <summary>
/// Brings the flag rows in line with the catalog (D-168): a declared flag without a row gets one with its default and a
/// <c>flag.registered</c> entry by System; an existing row only takes the description from code, so an Admin's targeting
/// survives every deploy. Rows no longer declared stay as they are (retired). Runs at startup and before every flag admin use
/// case; a cheap read when nothing is due, idempotent, and safe when several instances or requests run it at once.
/// </summary>
public sealed class FeatureFlagSync(ITicketingDbContext db, IFeatureFlagCatalog catalog, IFeatureFlagStore store, IClock clock)
{
    public const string RegisteredAction = "flag.registered";

    private const int Attempts = 3;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    public async Task EnsureAsync(CancellationToken cancellationToken)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                if (await SyncAsync(cancellationToken))
                    store.Invalidate();
                return;
            }
            catch (DbUpdateException ex) when ((ex is DbUpdateConcurrencyException || ex.IsUniqueViolation()) && attempt < Attempts)
            {
                db.ChangeTracker.Clear();
            }
        }
    }

    private async Task<bool> SyncAsync(CancellationToken cancellationToken)
    {
        var rows = await db.FeatureFlags
            .AsNoTracking()
            .Select(f => new { f.Id, f.Key, f.Description })
            .ToDictionaryAsync(f => f.Key, StringComparer.Ordinal, cancellationToken);
        var missing = catalog.Definitions.Where(d => !rows.ContainsKey(d.Key)).ToList();
        var redescribed = catalog.Definitions.Where(d => rows.TryGetValue(d.Key, out var row) && row.Description != d.Description).ToList();
        if (missing.Count == 0 && redescribed.Count == 0)
            return false;

        var now = clock.Now;
        foreach (var definition in missing)
        {
            var flag = FeatureFlag.Register(definition.Key, definition.Description, definition.DefaultOn, now);
            db.FeatureFlags.Add(flag);
            db.ActivityEntries.Add(ActivityEntry.Create(
                ActivityEntityType.FeatureFlag, flag.Id, null, actorId: null, channel: null, now, RegisteredAction,
                newValueJson: JsonSerializer.Serialize(FlagAdmin.Snapshot(flag), Json)));
        }
        if (redescribed.Count > 0)
        {
            var keys = redescribed.Select(d => d.Key).ToList();
            foreach (var flag in await db.FeatureFlags.Where(f => keys.Contains(f.Key)).ToListAsync(cancellationToken))
                flag.Describe(catalog.Find(flag.Key)!.Description);
        }
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
