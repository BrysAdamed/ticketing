using System.Text.Json;
using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;

namespace Ticketing.Infrastructure.Activity;

internal sealed class ActivityLog(ITicketingDbContext db, ICurrentUser currentUser, IClock clock) : IActivityLog
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public void Record(ActivityEntityType entityType, Guid entityId, Guid? projectId, string action, object? newValue = null) =>
        Add(entityType, entityId, projectId, action, field: null, oldValue: null, newValue);

    public void RecordChange<T>(ActivityEntityType entityType, Guid entityId, Guid? projectId, string action, string field, T oldValue, T newValue)
    {
        var oldJson = Serialize(oldValue);
        var newJson = Serialize(newValue);
        if (oldJson == newJson)
            return;
        db.ActivityEntries.Add(ActivityEntry.Create(entityType, entityId, projectId, ActorId, Channel, clock.Now, action, field, oldJson, newJson));
    }

    private void Add(ActivityEntityType entityType, Guid entityId, Guid? projectId, string action, string? field, object? oldValue, object? newValue) =>
        db.ActivityEntries.Add(ActivityEntry.Create(
            entityType, entityId, projectId, ActorId, Channel, clock.Now, action, field, Serialize(oldValue), Serialize(newValue)));

    private Guid? ActorId => currentUser.IsAuthenticated ? currentUser.Id : null;

    private WriteChannel? Channel => currentUser.IsAuthenticated ? currentUser.Channel : null;

    private static string? Serialize<T>(T value) => value is null ? null : JsonSerializer.Serialize(value, Json);
}
