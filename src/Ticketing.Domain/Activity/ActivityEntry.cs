using Ticketing.Domain.Common;

namespace Ticketing.Domain.Activity;

/// <summary>Append-only history and audit record (spec 4.14). Old and new values are JSON; secrets never go here.</summary>
public sealed class ActivityEntry
{
    public const int ActionMaxLength = 50;
    public const int FieldMaxLength = 50;

    private ActivityEntry()
    {
        Action = null!;
    }

    public Guid Id { get; private set; }

    public ActivityEntityType EntityType { get; private set; }

    public Guid EntityId { get; private set; }

    public Guid? ProjectId { get; private set; }

    public Guid? ActorId { get; private set; }

    public WriteChannel? Channel { get; private set; }

    public DateTimeOffset OccurredAt { get; private set; }

    public string Action { get; private set; }

    public string? Field { get; private set; }

    public string? OldValue { get; private set; }

    public string? NewValue { get; private set; }

    public static ActivityEntry Create(
        ActivityEntityType entityType, Guid entityId, Guid? projectId, Guid? actorId, WriteChannel? channel,
        DateTimeOffset occurredAt, string action, string? field = null, string? oldValueJson = null, string? newValueJson = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(action);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(action.Length, ActionMaxLength);
        if (field is not null)
            ArgumentOutOfRangeException.ThrowIfGreaterThan(field.Length, FieldMaxLength);

        return new ActivityEntry
        {
            Id = Common.EntityId.New(),
            EntityType = entityType,
            EntityId = entityId,
            ProjectId = projectId,
            ActorId = actorId,
            Channel = channel,
            OccurredAt = occurredAt,
            Action = action,
            Field = field,
            OldValue = oldValueJson,
            NewValue = newValueJson,
        };
    }
}
