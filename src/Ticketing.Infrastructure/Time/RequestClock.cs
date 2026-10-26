using Ticketing.Application.Abstractions;

namespace Ticketing.Infrastructure.Time;

internal sealed class RequestClock(TimeProvider time) : IClock
{
    private DateTimeOffset? _now;

    public DateTimeOffset Now => _now ??= time.GetUtcNow();
}
