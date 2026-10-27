using Microsoft.Extensions.Options;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Docs;

namespace Ticketing.Infrastructure.Pdf;

/// <summary>The print bundle files (<c>print.js</c>, <c>print.css</c>, fonts) from <see cref="PdfOptions.BundlePath"/>, read once.</summary>
internal sealed class PrintBundle(IOptions<PdfOptions> options)
{
    private static readonly string[] Required = ["print.js", "print.css"];
    private readonly SemaphoreSlim _lock = new(1, 1);
    private IReadOnlyList<PdfFile>? _files;

    public async Task<IReadOnlyList<PdfFile>> FilesAsync(CancellationToken cancellationToken)
    {
        if (_files is { } loaded)
            return loaded;
        await _lock.WaitAsync(cancellationToken);
        try
        {
            if (_files is null)
            {
                var directory = options.Value.BundlePath;
                if (!Required.All(name => File.Exists(Path.Combine(directory, name))))
                    throw ExportDocPdf.Unavailable();
                var files = new List<PdfFile>();
                foreach (var path in Directory.EnumerateFiles(directory).Where(IsBundleFile).Order(StringComparer.Ordinal))
                    files.Add(new PdfFile(Path.GetFileName(path), await File.ReadAllBytesAsync(path, cancellationToken)));
                _files = files;
            }
            return _files;
        }
        finally
        {
            _lock.Release();
        }
    }

    private static bool IsBundleFile(string path) =>
        Path.GetExtension(path).ToLowerInvariant() is ".js" or ".css" or ".woff2";
}
