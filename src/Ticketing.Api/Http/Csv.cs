using System.Globalization;
using System.Text;

namespace Ticketing.Api.Http;

/// <summary>
/// RFC 4180 CSV writing for exports: UTF-8 with BOM (Excel), CRLF rows, quoted when needed. Cells that a spreadsheet
/// would evaluate as a formula (<c>= + - @</c>, also after leading whitespace, or a leading tab or CR) are prefixed with
/// an apostrophe (CSV injection).
/// </summary>
public sealed class Csv(Stream stream) : IAsyncDisposable
{
    private readonly StreamWriter _writer = new(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true), bufferSize: 64 * 1024, leaveOpen: true);

    public Task WriteRowAsync(params IReadOnlyList<string?> cells)
    {
        var line = new StringBuilder();
        for (var i = 0; i < cells.Count; i++)
        {
            if (i > 0)
                line.Append(',');
            line.Append(Escape(cells[i]));
        }
        line.Append("\r\n");
        return _writer.WriteAsync(line.ToString());
    }

    public static string Date(DateTimeOffset? value) =>
        value?.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture) ?? string.Empty;

    public static string Escape(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return string.Empty;
        if (value[0] is '\t' or '\r' || value.AsSpan().TrimStart() is ['=' or '+' or '-' or '@', ..])
            value = "'" + value;
        return value.AsSpan().IndexOfAny(",\"\r\n") >= 0 ? "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"" : value;
    }

    public async ValueTask DisposeAsync()
    {
        await _writer.FlushAsync();
        await _writer.DisposeAsync();
    }
}
