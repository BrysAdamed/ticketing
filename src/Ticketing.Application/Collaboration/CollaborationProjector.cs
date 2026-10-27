using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Collaboration;

/// <summary>
/// The collaboration side effects of every write (D-93): reads the pending activity into events, applies the rules and adds
/// what they derive to the same unit of work. Each save costs a fixed number of queries however many entries it holds, and
/// read access is cached for the scope, so creating a batch of tickets does not query per ticket.
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
