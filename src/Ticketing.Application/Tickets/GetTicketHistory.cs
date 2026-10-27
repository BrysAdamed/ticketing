using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.Tickets;

/// <summary>
/// A ticket's activity entries, newest first (spec 4.14). Entries of one operation share <c>occurredAt</c>, so the UI
/// groups them. Assignee and reporter values are user ids, resolved in <see cref="TicketHistoryPage.Users"/>. Link entries
/// whose other ticket the caller cannot read are left out (spec 4.6). A <c>ticket.deleted</c> entry shows only its key and
/// board; what the deletion removed is kept for restore only.
/// </summary>
public static class GetTicketHistory
{
    private static readonly string[] UserFields = ["assignee", "reporter"];

    public sealed record Query(string KeyOrId, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, TicketHistoryPage>
    {
        public async Task<TicketHistoryPage> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            var page = request.Page ?? new PageRequest();
            var before = Cursor.Decode<HistoryCursor>(page.Cursor);
            var id = target.Id;

            var entries = db.ActivityEntries.AsNoTracking().Where(a => a.EntityType == ActivityEntityType.Ticket && a.EntityId == id);
            if (before is not null)
                entries = entries.Where(a => a.OccurredAt < before.At || (a.OccurredAt == before.At && a.Id.CompareTo(before.Id) < 0));

            var rows = await (
                    from a in entries
                    from u in db.Users.Where(u => u.Id == a.ActorId).DefaultIfEmpty()
                    orderby a.OccurredAt descending, a.Id descending
                    select new Row(
                        a.Id, a.OccurredAt, a.ActorId, u.Email, u.DisplayName, (bool?)u.IsActive, a.Channel, a.Action, a.Field, a.OldValue, a.NewValue))
                .ToCursorPageAsync(page, r => new HistoryCursor(r.OccurredAt, r.Id), cancellationToken);

            var items = rows.Items.Select(r => new ActivityEntryDto(
                r.Id, r.OccurredAt, TicketQueries.User(r.ActorId, r.ActorEmail, r.ActorName, r.ActorActive), r.Channel, r.Action, r.Field,
                Parse(r.OldValue), r.Action == DeleteTicket.Action ? Deletion(r.NewValue) : Parse(r.NewValue))).ToList();

            items = await HideUnreadableLinksAsync(items, cancellationToken);
            var users = await ReferencedUsersAsync(items, cancellationToken);
            return new TicketHistoryPage(items, rows.NextCursor, users);
        }

        private async Task<List<ActivityEntryDto>> HideUnreadableLinksAsync(List<ActivityEntryDto> items, CancellationToken cancellationToken)
        {
            var linked = items
                .Where(i => i.Action.StartsWith("ticket.link.", StringComparison.Ordinal))
                .Select(i => LinkedTicketId(i))
                .OfType<Guid>()
                .Distinct()
                .ToList();
            if (linked.Count == 0)
                return items;

            var readable = access.ReadableProjects();
            var visible = (await db.Tickets
                    .Where(t => linked.Contains(t.Id) && readable.Any(p => p.Id == t.ProjectId))
                    .Select(t => t.Id)
                    .ToListAsync(cancellationToken))
                .ToHashSet();
            return [.. items.Where(i => !i.Action.StartsWith("ticket.link.", StringComparison.Ordinal) || LinkedTicketId(i) is { } other && visible.Contains(other))];
        }

        private async Task<IReadOnlyList<UserRefDto>> ReferencedUsersAsync(List<ActivityEntryDto> items, CancellationToken cancellationToken)
        {
            var ids = items
                .Where(i => i.Field is not null && UserFields.Contains(i.Field))
                .SelectMany(i => new[] { i.OldValue, i.NewValue })
                .Select(v => v is { ValueKind: JsonValueKind.String } s && Guid.TryParse(s.GetString(), out var g) ? g : (Guid?)null)
                .OfType<Guid>()
                .Distinct()
                .ToList();
            if (ids.Count == 0)
                return [];
            return await db.Users.AsNoTracking()
                .Where(u => ids.Contains(u.Id))
                .Select(u => new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive))
                .ToListAsync(cancellationToken);
        }

        private static Guid? LinkedTicketId(ActivityEntryDto entry) =>
            entry.NewValue is { ValueKind: JsonValueKind.Object } value
            && value.TryGetProperty("ticketId", out var ticketId)
            && Guid.TryParse(ticketId.GetString(), out var id)
                ? id
                : null;

        private static JsonElement? Deletion(string? json)
        {
            if (Parse(json) is not { ValueKind: JsonValueKind.Object } value)
                return null;
            var key = value.TryGetProperty("key", out var k) && k.ValueKind == JsonValueKind.String ? k.GetString() : null;
            Guid? boardId = value.TryGetProperty("boardId", out var b) && b.ValueKind == JsonValueKind.String && b.TryGetGuid(out var board) ? board : null;
            return JsonSerializer.SerializeToElement(new { key, boardId }, JsonSerializerOptions.Web);
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
        Guid Id, DateTimeOffset OccurredAt, Guid? ActorId, string? ActorEmail, string? ActorName, bool? ActorActive, WriteChannel? Channel,
        string Action, string? Field, string? OldValue, string? NewValue);

    private sealed record HistoryCursor(DateTimeOffset At, Guid Id);
}
