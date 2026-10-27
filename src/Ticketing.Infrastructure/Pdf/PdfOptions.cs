namespace Ticketing.Infrastructure.Pdf;

/// <summary>The PDF renderer sidecar (Gotenberg, ADR 0014) and the print bundle the API posts to it.</summary>
public sealed class PdfOptions
{
    public const string Section = "Pdf";

    /// <summary>Gotenberg's base URL on the internal <c>render</c> network.</summary>
    public string Url { get; set; } = "http://pdf:3000";

    public string Username { get; set; } = "ticketing";

    /// <summary>Gotenberg's basic-auth password (<c>PDF_RENDERER_PASSWORD</c>). Empty turns PDF export off (<c>doc.export.unavailable</c>).</summary>
    public string? Password { get; set; }

    /// <summary>Directory with <c>print.js</c>, <c>print.css</c> and the fonts (<c>npm run build:print</c>); <c>/app/print</c> in the image.</summary>
    public string BundlePath { get; set; } = Path.Combine(AppContext.BaseDirectory, "print");

    /// <summary>Render a small document once at startup, so the first real export does not pay Chromium's cold start.</summary>
    public bool WarmUp { get; set; } = true;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(Password);
}
