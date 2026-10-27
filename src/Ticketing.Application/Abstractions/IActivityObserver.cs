using Ticketing.Domain.Activity;

namespace Ticketing.Application.Abstractions;

/// <summary>
/// Derives further changes from what a write recorded (D-93): watchers today, notifications later. Every write path records
/// activity, so an observer covers REST, MCP, bulk operations and background work without touching their handlers.
/// </summary>
public interface IActivityObserver
{
    /// <summary>
    /// Runs inside SaveChanges, before the write, for activity entries added since the last save. Entities the observer adds
    /// to the context are saved in the same transaction; it must not call SaveChanges itself.
    /// </summary>
    Task OnRecordingAsync(IReadOnlyList<ActivityEntry> entries, CancellationToken cancellationToken);
}
