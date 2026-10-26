namespace Ticketing.Application.Abstractions;

/// <summary>
/// Scoped clock over <see cref="TimeProvider"/>. <see cref="Now"/> is captured on first read and stays fixed for the
/// operation, so an entity change and its activity entries share one timestamp.
/// </summary>
public interface IClock
{
    DateTimeOffset Now { get; }
}
