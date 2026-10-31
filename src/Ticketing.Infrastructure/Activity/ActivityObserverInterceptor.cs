using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;

namespace Ticketing.Infrastructure.Activity;

/// <summary>
/// Hands the activity entries pending in a save to every <see cref="IActivityObserver"/> before the write (D-93), so what they
/// add commits with the change itself. Observers always run inside a transaction (D-159): the caller's, or one this interceptor
/// opens before them and commits right after the write, so their reads can lock rows and their statements roll back with a failed
/// write. Scoped like the context; observers are resolved lazily because they use the context.
/// </summary>
internal sealed class ActivityObserverInterceptor(IServiceProvider services) : SaveChangesInterceptor
{
    private readonly HashSet<Guid> _observed = [];
    private IDbContextTransaction? _owned;

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
        if (context.Database.CurrentTransaction is null)
            _owned = await context.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            foreach (var observer in services.GetServices<IActivityObserver>())
                await observer.OnRecordingAsync(entries, cancellationToken);
        }
        catch
        {
            await RollBackOwnedAsync();
            throw;
        }
        return result;
    }

    public override async ValueTask<int> SavedChangesAsync(
        SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        if (_owned is { } transaction)
        {
            _owned = null;
            await using (transaction)
                await transaction.CommitAsync(cancellationToken);
        }
        return result;
    }

    public override async Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default) =>
        await RollBackOwnedAsync();

    public override async Task SaveChangesCanceledAsync(DbContextEventData eventData, CancellationToken cancellationToken = default) =>
        await RollBackOwnedAsync();

    private async Task RollBackOwnedAsync()
    {
        if (_owned is not { } transaction)
            return;
        _owned = null;
        await using (transaction)
            await transaction.RollbackAsync(CancellationToken.None);
    }

    private List<ActivityEntry> Unobserved(DbContext context) =>
        [.. context.ChangeTracker.Entries<ActivityEntry>()
            .Where(e => e.State == EntityState.Added && !_observed.Contains(e.Entity.Id))
            .Select(e => e.Entity)];
}
