using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// A doc's history, newest first (spec 1.6, 1.12): its versions merged with the activity entries that no version represents.
/// <c>doc.updated</c> and <c>doc.version.restored</c> are the versions themselves, and <c>doc.created</c> is version 1 of a page
/// or diagram (folders have no versions, so theirs is listed). Paged by one keyset cursor over both sources.
/// </summary>
public static class GetDocHistory
{
    private static readonly string[] VersionActions = [DocPublisher.UpdatedAction, DocPublisher.VersionRestoredAction];

    public sealed record Query(string KeyOrId, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, DocHistoryPage>
    {
        public async Task<DocHistoryPage> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await DocLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            var page = request.Page ?? new PageRequest();
            var before = Cursor.Decode<HistoryCursor>(page.Cursor);
            var take = page.Size + 1;
            var id = target.Id;
            var isFolder = target.Kind == DocKind.Folder;

            var versions = db.DocVersions.AsNoTracking().Where(v => v.NodeId == id);
            var entries = db.ActivityEntries.AsNoTracking()
                .Where(a => a.EntityType == ActivityEntityType.Doc && a.EntityId == id && !VersionActions.Contains(a.Action)
                    && (isFolder || a.Action != CreateDoc.Action));
            if (before is not null)
            {
                versions = versions.Where(v => v.CreatedAt < before.At || (v.CreatedAt == before.At && v.Id.CompareTo(before.Id) < 0));
                entries = entries.Where(a => a.OccurredAt < before.At || (a.OccurredAt == before.At && a.Id.CompareTo(before.Id) < 0));
            }

            var versionItems = await (
                    from v in versions
                    join u in db.Users on v.AuthorId equals u.Id
                    orderby v.CreatedAt descending, v.Id descending
                    select new DocHistoryItemDto(
                        v.Id, DocHistoryItemType.Version, v.CreatedAt, new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive), v.Channel,
                        v.Number, v.Title, v.ChangeNote, v.RestoredFrom, v.LinesAdded, v.LinesRemoved, null, null, null, null))
                .Take(take)
                .ToListAsync(cancellationToken);
            var activityRows = await (
                    from a in entries
                    from u in db.Users.Where(u => u.Id == a.ActorId).DefaultIfEmpty()
                    orderby a.OccurredAt descending, a.Id descending
                    select new ActivityRow(
                        a.Id, a.OccurredAt, a.ActorId, u.Email, u.DisplayName, (bool?)u.IsActive, a.Channel, a.Action, a.Field, a.OldValue, a.NewValue))
                .Take(take)
                .ToListAsync(cancellationToken);

            var merged = versionItems
                .Concat(activityRows.Select(r => new DocHistoryItemDto(
                    r.Id, DocHistoryItemType.Activity, r.OccurredAt, TicketQueries.User(r.ActorId, r.ActorEmail, r.ActorName, r.ActorActive), r.Channel,
                    null, null, null, null, null, null, r.Action, r.Field, Parse(r.OldValue), Parse(r.NewValue))))
                .OrderByDescending(i => i.At)
                .ThenByDescending(i => i.Id)
                .ToList();
            string? nextCursor = null;
            if (merged.Count > page.Size)
            {
                merged.RemoveRange(page.Size, merged.Count - page.Size);
                nextCursor = Cursor.Encode(new HistoryCursor(merged[^1].At, merged[^1].Id));
            }

            var currentVersion = await db.DocNodes.Where(n => n.Id == id).Select(n => n.CurrentVersion).SingleAsync(cancellationToken);
            return new DocHistoryPage(target.Key, currentVersion, merged, nextCursor);
        }

        private static JsonElement? Parse(string? json)
        {
            if (json is null)
                return null;
            using var document = JsonDocument.Parse(json);
            return document.RootElement.Clone();
        }
    }

    private sealed record ActivityRow(
        Guid Id, DateTimeOffset OccurredAt, Guid? ActorId, string? ActorEmail, string? ActorName, bool? ActorActive, WriteChannel? Channel,
        string Action, string? Field, string? OldValue, string? NewValue);

    private sealed record HistoryCursor(DateTimeOffset At, Guid Id);
}
