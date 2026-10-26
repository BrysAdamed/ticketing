namespace Ticketing.Domain.Common;

/// <summary>Generates application-side identifiers (UUIDv7, time ordered, index friendly).</summary>
public static class EntityId
{
    public static Guid New() => Guid.CreateVersion7();
}
