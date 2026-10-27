using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Domain.Docs;

namespace Ticketing.Infrastructure.Pdf;

/// <summary>
/// <see cref="IPdfRenderer"/> over Gotenberg's Chromium HTML route (ADR 0014): posts the page, header, footer, the print bundle
/// and the export's files, waits for <c>window.__printReady</c>, and fails on uncaught script errors.
/// </summary>
internal sealed partial class GotenbergPdfRenderer(
    HttpClient http, IOptions<PdfOptions> options, PrintBundle bundle, ILogger<GotenbergPdfRenderer> logger) : IPdfRenderer
{
    public bool IsAvailable => options.Value.IsConfigured;

    public async Task<byte[]> RenderAsync(PdfRenderRequest request, CancellationToken cancellationToken)
    {
        if (!IsAvailable)
            throw ExportDocPdf.Unavailable();
        var files = await bundle.FilesAsync(cancellationToken);

        using var form = new MultipartFormDataContent();
        AddFile(form, "index.html", Encoding.UTF8.GetBytes(request.IndexHtml));
        AddFile(form, "header.html", Encoding.UTF8.GetBytes(request.HeaderHtml));
        AddFile(form, "footer.html", Encoding.UTF8.GetBytes(request.FooterHtml));
        foreach (var file in files)
            AddFile(form, file.Name, file.Content);
        foreach (var file in request.Files)
            AddFile(form, file.Name, file.Content);
        AddField(form, "preferCssPageSize", "true");
        AddField(form, "printBackground", "true");
        AddField(form, "emulatedMediaType", "print");
        AddField(form, "generateDocumentOutline", "true");
        AddField(form, "waitForExpression", "window.__printReady === true");
        AddField(form, "failOnConsoleExceptions", "true");

        using var message = new HttpRequestMessage(HttpMethod.Post, "forms/chromium/convert/html") { Content = form };
        var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{options.Value.Username}:{options.Value.Password}"));
        message.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        }
        catch (HttpRequestException exception)
        {
            LogUnreachable(logger, exception, options.Value.Url);
            throw Failed(ErrorKind.Unavailable, DocErrors.ExportUnavailable, "The PDF renderer is not reachable right now.");
        }

        using (response)
        {
            if (response.IsSuccessStatusCode)
                return await ReadAsync(response, cancellationToken);
            var detail = await response.Content.ReadAsStringAsync(cancellationToken);
            LogRejected(logger, (int)response.StatusCode, detail.Length > 500 ? detail[..500] : detail);
            throw response.StatusCode switch
            {
                HttpStatusCode.Unauthorized => Failed(
                    ErrorKind.Unavailable, DocErrors.ExportUnavailable, "The PDF renderer refused the server's credentials (PDF_RENDERER_PASSWORD)."),
                HttpStatusCode.ServiceUnavailable or HttpStatusCode.TooManyRequests => Failed(
                    ErrorKind.Unavailable, DocErrors.ExportUnavailable, "The PDF renderer is busy or restarting. Try again in a minute."),
                _ => Failed(ErrorKind.Conflict, DocErrors.ExportFailed, "The PDF renderer could not print this export."),
            };
        }
    }

    private static async Task<byte[]> ReadAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.Content.Headers.ContentLength > DocPrint.MaxBytes)
            throw DocPrint.TooLarge("The PDF would be larger than 100 MB. Export a smaller folder.");
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > DocPrint.MaxBytes)
                throw DocPrint.TooLarge("The PDF would be larger than 100 MB. Export a smaller folder.");
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    private static void AddFile(MultipartFormDataContent form, string name, ReadOnlyMemory<byte> content)
    {
        var part = new ReadOnlyMemoryContent(content);
        part.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(part, "files", name);
    }

    private static void AddField(MultipartFormDataContent form, string name, string value) => form.Add(new StringContent(value), name);

    private static AppException Failed(ErrorKind kind, string code, string message) =>
        new(kind, code, message, "Try again later; if it keeps failing, an administrator checks the pdf service logs.")
        {
            RetryAfter = kind == ErrorKind.Unavailable ? TimeSpan.FromSeconds(30) : null,
        };

    [LoggerMessage(Level = LogLevel.Error, Message = "The PDF renderer at {Url} is not reachable.")]
    private static partial void LogUnreachable(ILogger logger, Exception exception, string url);

    [LoggerMessage(Level = LogLevel.Warning, Message = "The PDF renderer answered {Status}: {Detail}")]
    private static partial void LogRejected(ILogger logger, int status, string detail);
}
