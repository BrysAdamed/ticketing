using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Collaboration;

/// <summary>
/// The collaboration side effects of every write (D-93, D-94): reads the pending activity into events, applies the rules and
/// adds what they derive (watchers, then notifications, so watchers added by this save are notified too) to the same unit of
/// work. Each save costs a fixed number of queries however many entries it holds, and read access is cached for the scope,
/// so creating a batch of tickets does not query per ticket.
/// </summary>
internal sealed class CollaborationProjector(ITicketingDbContext db) : IActivityObserver
{
    private readonly Dictionary<(Guid ProjectId, Guid UserId), bool> _canRead = [];

    public async Task OnRecordingAsync(IReadOnlyList<ActivityEntry> entries, CancellationToken cancellationToken)
    {
        var events = await CollaborationEvents.ReadAsync(db, entries, cancellationToken);
        if (events.Count == 0)
            return;

        var candidates = WatchingRules.Candidates(events);
        if (candidates.Count > 0)
            await AddWatchersAsync(candidates, cancellationToken);

        var watchers = await WatchersAsync(NotificationRules.WatchedTickets(events), cancellationToken);
        var notifications = NotificationRules.Candidates(events, watchers);
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
        foreach (var candidate in allowed.Where(c => !watching.Contains((c.TicketId, c.UserId))))
            db.TicketWatchers.Add(TicketWatcher.Create(candidate.TicketId, candidate.UserId, candidate.At));
    }

    private async Task NotifyAsync(IReadOnlyList<NotificationCandidate> candidates, CancellationToken cancellationToken)
    {
        await LoadReadersAsync(candidates.Select(c => (c.Event.ProjectId, c.RecipientId)), cancellationToken);
        var allowed = candidates.Where(c => _canRead[(c.Event.ProjectId, c.RecipientId)]).ToList();
        if (allowed.Count == 0)
            return;

        var names = await SummaryNamesAsync(allowed, cancellationToken);
        var open = await OpenNotificationsAsync(allowed, cancellationToken);
        foreach (var candidate in allowed)
        {
            var e = candidate.Event;
            var (ticketId, sessionId) = Subject(e);
            var summary = NotificationSummaries.For(candidate.Kind, e, names);
            var target = open
                .Where(n => n.Absorbs(candidate.RecipientId, e.ActorId, ticketId, sessionId, e.OccurredAt))
                .MaxBy(n => n.CreatedAt);
            if (target is not null)
            {
                target.Merge(candidate.Kind, summary, e.OccurredAt);
                continue;
            }

            var created = e is RegressionItemAssigned item
                ? Notification.AboutRegressionItem(candidate.RecipientId, e.ProjectId, item.SessionId, item.TestCaseKey, e.ActorId, candidate.Kind, summary, e.OccurredAt)
                : Notification.AboutTicket(candidate.RecipientId, e.ProjectId, ticketId!.Value, e.ActorId, candidate.Kind, summary, e.OccurredAt);
            db.Notifications.Add(created);
            open.Add(created);
        }
    }

    private static (Guid? TicketId, Guid? SessionId) Subject(CollaborationEvent e) => e switch
    {
        TicketEvent t => (t.TicketId, null),
        RegressionItemAssigned item => (null, item.SessionId),
        _ => throw new InvalidOperationException($"Notifications about {e.GetType().Name} are not supported."),
    };

    /// <summary>Unread notifications of the same recipients and subjects young enough to absorb these events (tracked or stored).</summary>
    private async Task<List<Notification>> OpenNotificationsAsync(IReadOnlyList<NotificationCandidate> candidates, CancellationToken cancellationToken)
    {
        var recipientIds = candidates.Select(c => c.RecipientId).Distinct().ToList();
        var subjects = candidates.Select(c => Subject(c.Event)).ToList();
        var ticketIds = subjects.Where(s => s.TicketId is not null).Select(s => s.TicketId!.Value).Distinct().ToList();
        var sessionIds = subjects.Where(s => s.SessionId is not null).Select(s => s.SessionId!.Value).Distinct().ToList();
        var since = candidates.Min(c => c.Event.OccurredAt) - Notification.CollapseWindow;

        await db.Notifications
            .Where(n => recipientIds.Contains(n.RecipientId) && n.ReadAt == null && n.CreatedAt >= since
                && ((n.TicketId != null && ticketIds.Contains(n.TicketId.Value))
                    || (n.RegressionSessionId != null && sessionIds.Contains(n.RegressionSessionId.Value))))
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

        var newTickets = db.ChangeTracker.Entries<Ticket>().Where(e => e.State == EntityState.Added).Select(e => e.Entity.Id).ToHashSet();
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
