using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Ticketing.Application.Abstractions;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>
/// The test host's <see cref="IPdfRenderer"/>: records every bundle the API would post to Gotenberg and answers a tiny PDF.
/// Leak tests assert on the recorded data, which is everything the renderer could ever show.
/// </summary>
public sealed class FakePdfRenderer : IPdfRenderer
{
    public static readonly byte[] Pdf = "%PDF-1.7\n% fake\n"u8.ToArray();

    private readonly ConcurrentQueue<PdfRenderRequest> _requests = new();
    private TaskCompletionSource? _gate;
    private int _running;

    public bool IsAvailable { get; set; } = true;

    public IReadOnlyList<PdfRenderRequest> Requests => [.. _requests];

    public PdfRenderRequest Last => _requests.Last();

    public int Running => Volatile.Read(ref _running);

    /// <summary>Holds every render until <see cref="Release"/>.</summary>
    public void Hold() => _gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

    public void Release() => _gate?.TrySetResult();

    public void Reset()
    {
        Release();
        _gate = null;
        _requests.Clear();
        IsAvailable = true;
    }

    public async Task<byte[]> RenderAsync(PdfRenderRequest request, CancellationToken cancellationToken)
    {
        _requests.Enqueue(request);
        Interlocked.Increment(ref _running);
        try
        {
            if (_gate is { } gate)
                await gate.Task.WaitAsync(cancellationToken);
            return Pdf;
        }
        finally
        {
            Interlocked.Decrement(ref _running);
        }
    }

    /// <summary>The export data the print script would render (<c>#tk-print-data</c> of <c>index.html</c>).</summary>
    public static JsonElement Data(PdfRenderRequest request)
    {
        const string start = "<script type=\"application/json\" id=\"tk-print-data\">";
        var html = request.IndexHtml;
        var from = html.IndexOf(start, StringComparison.Ordinal) + start.Length;
        var to = html.IndexOf("</script>", from, StringComparison.Ordinal);
        return JsonDocument.Parse(html[from..to]).RootElement.Clone();
    }

    /// <summary>Everything the renderer receives as one string: page, header, footer and the text of every file.</summary>
    public static string Everything(PdfRenderRequest request) =>
        string.Join('\n', [request.IndexHtml, request.HeaderHtml, request.FooterHtml, .. request.Files.Select(f => Encoding.UTF8.GetString(f.Content.Span))]);
}
