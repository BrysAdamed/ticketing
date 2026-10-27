using System.Globalization;
using Ticketing.Application.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Admission for PDF exports (docs refinement 1.11): at most <see cref="MaxRunning"/> exports run at once and
/// <see cref="MaxQueued"/> wait; beyond that <c>429 doc.export.busy</c> with <c>Retry-After</c>. One per API process (singleton).
/// </summary>
public sealed class DocExportQueue
{
    public const int MaxRunning = 2;
    public const int MaxQueued = 10;
    public static readonly TimeSpan RetryAfter = TimeSpan.FromSeconds(15);

    private readonly SemaphoreSlim _slots = new(MaxRunning, MaxRunning);
    private int _admitted;

    /// <summary>Exports running or waiting right now.</summary>
    public int Admitted => Volatile.Read(ref _admitted);

    /// <summary>Waits for a free slot; dispose the result to release it. Throws <c>doc.export.busy</c> when the queue is full.</summary>
    public async Task<IDisposable> EnterAsync(CancellationToken cancellationToken)
    {
        if (Interlocked.Increment(ref _admitted) > MaxRunning + MaxQueued)
        {
            Interlocked.Decrement(ref _admitted);
            throw Busy();
        }
        try
        {
            await _slots.WaitAsync(cancellationToken);
        }
        catch
        {
            Interlocked.Decrement(ref _admitted);
            throw;
        }
        return new Slot(this);
    }

    private void Release()
    {
        _slots.Release();
        Interlocked.Decrement(ref _admitted);
    }

    private static AppException Busy() =>
        new(ErrorKind.TooManyRequests, DocErrors.ExportBusy,
            string.Create(CultureInfo.InvariantCulture, $"Too many PDF exports are running. Try again in {RetryAfter.TotalSeconds:0} seconds."))
        {
            RetryAfter = RetryAfter,
            Details = new Dictionary<string, object?> { ["retryAfter"] = (int)RetryAfter.TotalSeconds },
        };

    private sealed class Slot(DocExportQueue queue) : IDisposable
    {
        private int _released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0)
                queue.Release();
        }
    }
}
