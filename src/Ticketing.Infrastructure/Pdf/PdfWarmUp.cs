using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;

namespace Ticketing.Infrastructure.Pdf;

/// <summary>
/// Renders one small page with a Mermaid diagram after startup, so Chromium's cold start and font cache (17 s in the
/// TKT-11 spike) are not paid by the first user. Retries while the sidecar is still starting; never blocks startup.
/// </summary>
internal sealed partial class PdfWarmUp(IServiceScopeFactory scopes, IOptions<PdfOptions> options, ILogger<PdfWarmUp> logger) : BackgroundService
{
    private const int Attempts = 6;
    private static readonly TimeSpan Pause = TimeSpan.FromSeconds(10);

    private const string Sample = """
        {"mode":"single","appUrl":"http://localhost","projectKey":"WARM","projectName":"Warm-up","exportedBy":"Ticketing","exportedAt":"",
        "folder":null,"entries":[{"key":"WARM-D-1","kind":"Page","diagramFormat":null,"title":"Warm-up","depth":0,"version":1,"path":"Warm-up",
        "updatedBy":"Ticketing","updatedAt":"","content":"## Warm-up\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```csharp\nvar x = 1;\n```",
        "picture":null,"references":{"tickets":[],"docs":[],"embeds":[]},"images":{}}]}
        """;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.IsConfigured)
        {
            LogDisabled(logger);
            return;
        }
        if (!options.Value.WarmUp)
            return;
        var request = new PdfRenderRequest(
            $"<!doctype html><html><head><meta charset=\"utf-8\"><link rel=\"stylesheet\" href=\"print.css\"></head><body><main></main>"
            + $"<script type=\"application/json\" id=\"tk-print-data\">{Sample}</script><script src=\"print.js\"></script></body></html>",
            "<html><body></body></html>", "<html><body></body></html>", []);
        for (var attempt = 1; attempt <= Attempts && !stoppingToken.IsCancellationRequested; attempt++)
        {
            try
            {
                await Task.Delay(Pause, stoppingToken);
                using var scope = scopes.CreateScope();
                var pdf = await scope.ServiceProvider.GetRequiredService<IPdfRenderer>().RenderAsync(request, stoppingToken);
                LogWarm(logger, pdf.Length);
                return;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (AppException exception)
            {
                LogRetry(logger, attempt, exception.Code);
            }
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "PDF export is off: PDF_RENDERER_PASSWORD (Pdf:Password) is not set.")]
    private static partial void LogDisabled(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "PDF renderer warmed up ({Bytes} bytes).")]
    private static partial void LogWarm(ILogger logger, int bytes);

    [LoggerMessage(Level = LogLevel.Information, Message = "PDF renderer warm-up attempt {Attempt} failed with {Code}.")]
    private static partial void LogRetry(ILogger logger, int attempt, string code);
}
