using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;

namespace Ticketing.Infrastructure.Activity;

/// <summary>
/// Hands the activity entries pending in a save to every <see cref="IActivityObserver"/> before the write (D-93), so what they
/// add commits with the change itself. Scoped like the context; observers are resolved lazily because they use the context.
/// </summary>
internal sealed class ActivityObserverInterceptor(IServiceProvider services) : SaveChangesInterceptor
{
    private readonly HashSet<Guid> _observed = [];

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is { } context && Unobserved(context).Count > 0)
            throw new InvalidOperationException("Activity is saved with SaveChangesAsync only, so that activity observers can run.");
        return result;
    }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        if (eventData.Context is not { } context)
            return result;
        var entries = Unobserved(context);
        if (entries.Count == 0)
            return result;

        foreach (var entry in entries)
            _observed.Add(entry.Id);
        foreach (var observer in services.GetServices<IActivityObserver>())
            await observer.OnRecordingAsync(entries, cancellationToken);
        return result;
    }

    private List<ActivityEntry> Unobserved(DbContext context) =>
        [.. context.ChangeTracker.Entries<ActivityEntry>()
            .Where(e => e.State == EntityState.Added && !_observed.Contains(e.Entity.Id))
            .Select(e => e.Entity)];
}
