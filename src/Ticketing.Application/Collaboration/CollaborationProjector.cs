using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Collaboration;

/// <summary>
/// The collaboration side effects of every write (D-93, D-94, D-96): reads the pending activity into events, applies the rules
/// (mentions feed both others) and adds what they derive (watchers, then notifications, so watchers added by this save are
/// notified too) to the same unit of work. Each save costs a fixed number of queries however many entries it holds, and read
/// access is cached for the scope, so creating a batch of tickets does not query per ticket. Concurrent writes neither fail on a
/// watcher someone added meanwhile nor lose a notification count (D-159).
/// </summary>
internal sealed class CollaborationProjector(ITicketingDbContext db) : IActivityObserver
{
    private readonly Dictionary<(Guid ProjectId, Guid UserId), bool> _canRead = [];

    public async Task OnRecordingAsync(IReadOnlyList<ActivityEntry> entries, CancellationToken cancellationToken)
    {
        var events = await CollaborationEvents.ReadAsync(db, entries, cancellationToken);
        if (events.Count == 0)
            return;

        var mentions = MentionRules.Candidates(events);
        var candidates = WatchingRules.Candidates(events, mentions);
        if (candidates.Count > 0)
            await AddWatchersAsync(candidates, cancellationToken);
        var docCandidates = WatchingRules.DocCandidates(events);
        if (docCandidates.Count > 0)
            await AddDocWatchersAsync(docCandidates, cancellationToken);

        var watchers = await WatchersAsync(NotificationRules.WatchedTickets(events), cancellationToken);
        var docWatchers = await DocWatchersAsync(NotificationRules.WatchedDocs(events), cancellationToken);
        var notifications = NotificationRules.Candidates(events, watchers, mentions, docWatchers);
        if (notifications.Count > 0)
            await NotifyAsync(notifications, cancellationToken);
    }

    private async Task AddWatchersAsync(IReadOnlyList<WatchCandidate> candidates, CancellationToken cancellationToken)
    {
        await LoadReadersAsync(candidates.Select(c => (c.ProjectId, c.UserId)), cancellationToken);
        var allowed = candidates.Where(c => _canRead[(c.ProjectId, c.UserId)]).ToList();
        if (allowed.Count == 0)
            return;

        var watching = await WatchingAsync(allowed, cancellationToken);
        var newTickets = NewTicketIds();
        var stored = new List<TicketWatcher>();
        foreach (var candidate in allowed.Where(c => !watching.Contains((c.TicketId, c.UserId))))
        {
            var watcher = TicketWatcher.Create(candidate.TicketId, candidate.UserId, candidate.At);
            if (newTickets.Contains(candidate.TicketId))
                db.TicketWatchers.Add(watcher);
            else
                stored.Add(watcher);
        }
        if (stored.Count > 0)
            await InsertWatchersAsync(stored, cancellationToken);
    }

    /// <summary>
    /// Adds watchers of existing tickets in the save's transaction, tolerating a concurrent explicit watch of the same user (D-159):
    /// a tracked insert would fail the whole write on the primary key.
    /// </summary>
    private async Task InsertWatchersAsync(IReadOnlyList<TicketWatcher> watchers, CancellationToken cancellationToken)
    {
        var ticketIds = watchers.Select(w => w.TicketId).ToArray();
        var userIds = watchers.Select(w => w.UserId).ToArray();
        var createdAt = watchers.Select(w => w.CreatedAt).ToArray();
        await db.Database.ExecuteSqlAsync(
            $"INSERT INTO ticket_watchers (ticket_id, user_id, created_at) SELECT * FROM unnest({ticketIds}, {userIds}, {createdAt}) ON CONFLICT DO NOTHING",
            cancellationToken);
    }

    /// <summary>
    /// Adds doc watchers like ticket watchers (D-159, D-161): tracked rows for docs created in this save, otherwise one insert that
    /// tolerates a concurrent explicit watch. Whoever is watching already stays as they are.
    /// </summary>
    private async Task AddDocWatchersAsync(IReadOnlyList<DocWatchCandidate> candidates, CancellationToken cancellationToken)
    {
        await LoadReadersAsync(candidates.Select(c => (c.ProjectId, c.UserId)), cancellationToken);
        var allowed = candidates.Where(c => _canRead[(c.ProjectId, c.UserId)]).ToList();
        if (allowed.Count == 0)
            return;

        var newDocs = db.ChangeTracker.Entries<DocNode>().Where(e => e.State == EntityState.Added).Select(e => e.Entity.Id).ToHashSet();
        var tracked = db.ChangeTracker.Entries<DocWatcher>()
            .Where(e => e.State != EntityState.Deleted)
            .Select(e => (e.Entity.DocNodeId, e.Entity.UserId))
            .ToHashSet();
        var stored = new List<DocWatcher>();
        foreach (var candidate in allowed.Where(c => !tracked.Contains((c.DocNodeId, c.UserId))))
        {
            var watcher = DocWatcher.Create(candidate.DocNodeId, candidate.UserId, candidate.At);
            if (newDocs.Contains(candidate.DocNodeId))
                db.DocWatchers.Add(watcher);
            else
                stored.Add(watcher);
        }
        if (stored.Count == 0)
            return;

        var docIds = stored.Select(w => w.DocNodeId).ToArray();
        var userIds = stored.Select(w => w.UserId).ToArray();
        var createdAt = stored.Select(w => w.CreatedAt).ToArray();
        await db.Database.ExecuteSqlAsync(
            $"INSERT INTO doc_watchers (doc_node_id, user_id, created_at) SELECT * FROM unnest({docIds}, {userIds}, {createdAt}) ON CONFLICT DO NOTHING",
            cancellationToken);
    }

    private HashSet<Guid> NewTicketIds() =>
        db.ChangeTracker.Entries<Ticket>().Where(e => e.State == EntityState.Added).Select(e => e.Entity.Id).ToHashSet();

    private async Task NotifyAsync(IReadOnlyList<NotificationCandidate> all, CancellationToken cancellationToken)
    {
        var candidates = NotificationRules.Unmuted(all, await PreferencesAsync(all, cancellationToken));
        if (candidates.Count == 0)
            return;

        await LoadReadersAsync(candidates.Select(c => (c.Event.ProjectId, c.RecipientId)), cancellationToken);
        var allowed = candidates.Where(c => _canRead[(c.Event.ProjectId, c.RecipientId)]).ToList();
        if (allowed.Count == 0)
            return;

        var names = await SummaryNamesAsync(allowed, cancellationToken);
        var open = await OpenNotificationsAsync(allowed, cancellationToken);
        foreach (var candidate in allowed)
        {
            var e = candidate.Event;
            var (ticketId, sessionId, docNodeId) = Subject(e);
            var summary = NotificationSummaries.For(candidate.Kind, e, names);
            var target = open
                .Where(n => n.Absorbs(candidate.RecipientId, e.ActorId, ticketId, sessionId, docNodeId, e.OccurredAt))
                .MaxBy(n => n.CreatedAt);
            if (target is not null)
            {
                target.Merge(candidate.Kind, summary, e.OccurredAt);
                continue;
            }

            var created = e switch
            {
                RegressionItemAssigned item => Notification.AboutRegressionItem(
                    candidate.RecipientId, e.ProjectId, item.SessionId, item.TestCaseKey, e.ActorId, candidate.Kind, summary, e.OccurredAt),
                DocEvent doc => Notification.AboutDoc(candidate.RecipientId, e.ProjectId, doc.DocNodeId, e.ActorId, candidate.Kind, summary, e.OccurredAt),
                _ => Notification.AboutTicket(candidate.RecipientId, e.ProjectId, ticketId!.Value, e.ActorId, candidate.Kind, summary, e.OccurredAt),
            };
            db.Notifications.Add(created);
            open.Add(created);
        }
    }

    private async Task<Dictionary<Guid, NotificationPreferences>> PreferencesAsync(IReadOnlyList<NotificationCandidate> candidates, CancellationToken cancellationToken)
    {
        var recipientIds = candidates.Select(c => c.RecipientId).Distinct().ToList();
        return await db.NotificationPreferences.AsNoTracking()
            .Where(p => recipientIds.Contains(p.UserId))
            .ToDictionaryAsync(p => p.UserId, cancellationToken);
    }

    private static (Guid? TicketId, Guid? SessionId, Guid? DocNodeId) Subject(CollaborationEvent e) => e switch
    {
        TicketEvent t => (t.TicketId, null, null),
        RegressionItemAssigned item => (null, item.SessionId, null),
        DocEvent doc => (null, null, doc.DocNodeId),
        _ => throw new InvalidOperationException($"Notifications about {e.GetType().Name} are not supported."),
    };

    /// <summary>
    /// Unread notifications of the same recipients and subjects young enough to absorb these events (tracked or stored). Stored
    /// rows are locked until the save commits, so a concurrent merge into the same row waits and then reads its latest count
    /// (D-159).
    /// </summary>
    private async Task<List<Notification>> OpenNotificationsAsync(IReadOnlyList<NotificationCandidate> candidates, CancellationToken cancellationToken)
    {
        var recipientIds = candidates.Select(c => c.RecipientId).Distinct().ToArray();
        var subjects = candidates.Select(c => Subject(c.Event)).ToList();
        var ticketIds = subjects.Where(s => s.TicketId is not null).Select(s => s.TicketId!.Value).Distinct().ToArray();
        var sessionIds = subjects.Where(s => s.SessionId is not null).Select(s => s.SessionId!.Value).Distinct().ToArray();
        var docNodeIds = subjects.Where(s => s.DocNodeId is not null).Select(s => s.DocNodeId!.Value).Distinct().ToArray();
        var since = candidates.Min(c => c.Event.OccurredAt) - Notification.CollapseWindow;

        await db.Notifications
            .FromSql($"""
                SELECT * FROM notifications
                WHERE recipient_id = ANY({recipientIds}) AND read_at IS NULL AND created_at >= {since}
                  AND (ticket_id = ANY({ticketIds}) OR regression_session_id = ANY({sessionIds}) OR doc_node_id = ANY({docNodeIds}))
                ORDER BY id
                FOR UPDATE
                """)
            .LoadAsync(cancellationToken);
        return [.. db.ChangeTracker.Entries<Notification>().Where(e => e.State != EntityState.Deleted).Select(e => e.Entity)];
    }

    private async Task<SummaryNames> SummaryNamesAsync(IReadOnlyList<NotificationCandidate> candidates, CancellationToken cancellationToken)
    {
        var boardIds = candidates.Select(c => c.Event).OfType<TicketMoved>().Select(m => m.ToBoardId).OfType<Guid>().Distinct().ToList();
        var sessionIds = candidates.Select(c => c.Event).OfType<RegressionItemAssigned>().Select(a => a.SessionId).Distinct().ToList();

        var boards = boardIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.Boards.AsNoTracking()
                .Where(b => boardIds.Contains(b.Id))
                .ToDictionaryAsync(b => b.Id, b => b.Name, cancellationToken);
        var sessions = new Dictionary<Guid, SessionLabel>();
        if (sessionIds.Count > 0)
        {
            var rows = await (
                    from s in db.RegressionSessions.AsNoTracking()
                    where sessionIds.Contains(s.Id)
                    join p in db.Projects.AsNoTracking() on s.ProjectId equals p.Id
                    select new { s.Id, p.Key, s.Number, s.Name })
                .ToListAsync(cancellationToken);
            foreach (var row in rows)
                sessions[row.Id] = new SessionLabel(HumanKeys.Regression(row.Key, row.Number), row.Name);
        }
        return new SummaryNames(boards, sessions);
    }

    /// <summary>Stored and tracked watchers of <paramref name="ticketIds"/>, before read access is checked.</summary>
    private async Task<ILookup<Guid, Guid>> WatchersAsync(IReadOnlyCollection<Guid> ticketIds, CancellationToken cancellationToken)
    {
        if (ticketIds.Count == 0)
            return Array.Empty<(Guid TicketId, Guid UserId)>().ToLookup(w => w.TicketId, w => w.UserId);

        var tracked = db.ChangeTracker.Entries<TicketWatcher>()
            .Where(e => e.State != EntityState.Deleted && ticketIds.Contains(e.Entity.TicketId))
            .Select(e => (e.Entity.TicketId, e.Entity.UserId));
        var stored = await db.TicketWatchers.AsNoTracking()
            .Where(w => ticketIds.Contains(w.TicketId))
            .Select(w => new { w.TicketId, w.UserId })
            .ToListAsync(cancellationToken);
        return stored.Select(w => (w.TicketId, w.UserId)).Concat(tracked).Distinct().ToLookup(w => w.TicketId, w => w.UserId);
    }

    /// <summary>Stored and tracked watchers of <paramref name="docNodeIds"/>, before read access is checked.</summary>
    private async Task<ILookup<Guid, Guid>> DocWatchersAsync(IReadOnlyCollection<Guid> docNodeIds, CancellationToken cancellationToken)
    {
        if (docNodeIds.Count == 0)
            return Array.Empty<(Guid DocNodeId, Guid UserId)>().ToLookup(w => w.DocNodeId, w => w.UserId);

        var tracked = db.ChangeTracker.Entries<DocWatcher>()
            .Where(e => e.State != EntityState.Deleted && docNodeIds.Contains(e.Entity.DocNodeId))
            .Select(e => (e.Entity.DocNodeId, e.Entity.UserId));
        var stored = await db.DocWatchers.AsNoTracking()
            .Where(w => docNodeIds.Contains(w.DocNodeId))
            .Select(w => new { w.DocNodeId, w.UserId })
            .ToListAsync(cancellationToken);
        return stored.Select(w => (w.DocNodeId, w.UserId)).Concat(tracked).Distinct().ToLookup(w => w.DocNodeId, w => w.UserId);
    }

    private async Task LoadReadersAsync(IEnumerable<(Guid ProjectId, Guid UserId)> pairs, CancellationToken cancellationToken)
    {
        var missing = pairs.Where(p => !_canRead.ContainsKey(p)).Distinct().ToList();
        if (missing.Count == 0)
            return;

        var projectIds = missing.Select(p => p.ProjectId).Distinct().ToList();
        var userIds = missing.Select(p => p.UserId).Distinct().ToList();
        var readers = await ProjectReaders
            .Among(db, db.Projects.Where(p => projectIds.Contains(p.Id)), db.Users.Where(u => userIds.Contains(u.Id)))
            .Select(r => new { r.ProjectId, r.UserId })
            .ToListAsync(cancellationToken);
        foreach (var pair in missing)
            _canRead[pair] = false;
        foreach (var reader in readers)
            _canRead[(reader.ProjectId, reader.UserId)] = true;
    }

    private async Task<HashSet<(Guid TicketId, Guid UserId)>> WatchingAsync(IReadOnlyList<WatchCandidate> candidates, CancellationToken cancellationToken)
    {
        var watching = db.ChangeTracker.Entries<TicketWatcher>()
            .Where(e => e.State != EntityState.Deleted)
            .Select(e => (e.Entity.TicketId, e.Entity.UserId))
            .ToHashSet();

        var newTickets = NewTicketIds();
        var ticketIds = candidates.Select(c => c.TicketId).Where(id => !newTickets.Contains(id)).Distinct().ToList();
        if (ticketIds.Count == 0)
            return watching;

        var userIds = candidates.Select(c => c.UserId).Distinct().ToList();
        var stored = await db.TicketWatchers.AsNoTracking()
            .Where(w => ticketIds.Contains(w.TicketId) && userIds.Contains(w.UserId))
            .Select(w => new { w.TicketId, w.UserId })
            .ToListAsync(cancellationToken);
        foreach (var row in stored)
            watching.Add((row.TicketId, row.UserId));
        return watching;
    }
}
