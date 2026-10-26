using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.Audit;

/// <summary>An admin audit row. <see cref="EntityLabel"/> is the current email, flag key, project key or token name, when the entity still exists.</summary>
public sealed record AuditEntryDto(
    Guid Id,
    DateTimeOffset OccurredAt,
    UserLookupDto? Actor,
    WriteChannel? Channel,
    ActivityEntityType EntityType,
    Guid EntityId,
    string? EntityLabel,
    string Action,
    string? Field,
    JsonElement? OldValue,
    JsonElement? NewValue);

/// <summary>
/// The admin audit trail (I-13): activity on users, tokens, flags and projects, newest first, filtered by actor, entity,
/// action (exact code or a prefix such as <c>user.</c>) and time range.
/// </summary>
public static class ListAuditEntries
{
    public static readonly IReadOnlyList<ActivityEntityType> AuditedTypes =
        [ActivityEntityType.User, ActivityEntityType.PersonalAccessToken, ActivityEntityType.FeatureFlag, ActivityEntityType.Project];

    public sealed record Query(
        Guid? ActorId = null,
        ActivityEntityType? EntityType = null,
        Guid? EntityId = null,
        string? Action = null,
        DateTimeOffset? From = null,
        DateTimeOffset? To = null,
        PageRequest? Page = null) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Must(EntityType is null || AuditedTypes.Contains(EntityType.Value), "entityType",
                $"entityType must be one of {string.Join(", ", AuditedTypes)}.")
            .Must(From is null || To is null || From <= To, "from", "from must not be after to.")
            .MaxLength("action", Action, ActivityEntry.ActionMaxLength);
    }

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser) : IHandler<Query, CursorPage<AuditEntryDto>>
    {
        public async Task<CursorPage<AuditEntryDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            request.EnsureValid();
            currentUser.EnsureAdminWebSession();
            var page = request.Page ?? new PageRequest();
            var after = Cursor.Decode<TimeCursor>(page.Cursor);

            var types = request.EntityType is { } type ? [type] : AuditedTypes.ToList();
            var entries = db.ActivityEntries.AsNoTracking().Where(a => types.Contains(a.EntityType));
            if (request.ActorId is { } actorId)
                entries = entries.Where(a => a.ActorId == actorId);
            if (request.EntityId is { } entityId)
                entries = entries.Where(a => a.EntityId == entityId);
            if (!string.IsNullOrWhiteSpace(request.Action))
            {
                var action = request.Action.Trim();
                entries = action.EndsWith('.')
                    ? entries.Where(a => a.Action.StartsWith(action))
                    : entries.Where(a => a.Action == action);
            }
            if (request.From is { } from)
                entries = entries.Where(a => a.OccurredAt >= from);
            if (request.To is { } to)
                entries = entries.Where(a => a.OccurredAt <= to);
            if (after is not null)
                entries = entries.Where(a => EF.Functions.LessThan(ValueTuple.Create(a.OccurredAt, a.Id), ValueTuple.Create(after.At, after.Id)));

            var rows = await entries
                .OrderByDescending(a => a.OccurredAt)
                .ThenByDescending(a => a.Id)
                .Select(a => new Row(
                    a.Id, a.OccurredAt, a.ActorId, a.Channel, a.EntityType, a.EntityId, a.Action, a.Field, a.OldValue, a.NewValue,
                    db.Users.Where(u => u.Id == a.ActorId).Select(u => new UserLookupDto(u.Id, u.Email, u.DisplayName, u.IsActive)).FirstOrDefault()))
                .ToCursorPageAsync(page, r => new TimeCursor(r.OccurredAt, r.Id), cancellationToken);

            var labels = await LabelsAsync(rows.Items, cancellationToken);
            return rows.Map(r => new AuditEntryDto(
                r.Id, r.OccurredAt, r.Actor, r.Channel, r.EntityType, r.EntityId, labels.GetValueOrDefault(r.EntityId), r.Action, r.Field,
                Parse(r.OldValue), Parse(r.NewValue)));
        }

        private async Task<Dictionary<Guid, string>> LabelsAsync(IReadOnlyList<Row> rows, CancellationToken cancellationToken)
        {
            List<Guid> Ids(ActivityEntityType type) => [.. rows.Where(r => r.EntityType == type).Select(r => r.EntityId).Distinct()];
            var userIds = Ids(ActivityEntityType.User);
            var tokenIds = Ids(ActivityEntityType.PersonalAccessToken);
            var flagIds = Ids(ActivityEntityType.FeatureFlag);
            var projectIds = Ids(ActivityEntityType.Project);

            var labels = new Dictionary<Guid, string>();
            if (userIds.Count > 0)
                foreach (var u in await db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id)).Select(u => new { u.Id, u.Email }).ToListAsync(cancellationToken))
                    labels[u.Id] = u.Email;
            if (tokenIds.Count > 0)
                foreach (var t in await db.PersonalAccessTokens.AsNoTracking().Where(t => tokenIds.Contains(t.Id)).Select(t => new { t.Id, t.Name }).ToListAsync(cancellationToken))
                    labels[t.Id] = t.Name;
            if (flagIds.Count > 0)
                foreach (var f in await db.FeatureFlags.AsNoTracking().Where(f => flagIds.Contains(f.Id)).Select(f => new { f.Id, f.Key }).ToListAsync(cancellationToken))
                    labels[f.Id] = f.Key;
            if (projectIds.Count > 0)
                foreach (var p in await db.Projects.AsNoTracking().Where(p => projectIds.Contains(p.Id)).Select(p => new { p.Id, p.Key }).ToListAsync(cancellationToken))
                    labels[p.Id] = p.Key;
            return labels;
        }

        private static JsonElement? Parse(string? json)
        {
            if (json is null)
                return null;
            using var document = JsonDocument.Parse(json);
            return document.RootElement.Clone();
        }
    }

    private sealed record Row(
        Guid Id, DateTimeOffset OccurredAt, Guid? ActorId, WriteChannel? Channel, ActivityEntityType EntityType, Guid EntityId,
        string Action, string? Field, string? OldValue, string? NewValue, UserLookupDto? Actor);

    private sealed record TimeCursor(DateTimeOffset At, Guid Id);
}
