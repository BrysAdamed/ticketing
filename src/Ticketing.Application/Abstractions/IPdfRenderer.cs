namespace Ticketing.Application.Abstractions;

/// <summary>
/// Prints an offline HTML bundle to PDF (D-100, ADR 0013). The renderer adds the print bundle itself (<c>print.js</c>,
/// <c>print.css</c>, fonts); everything else it may show is in the request, already filtered for the exporting user,
/// and it never calls back. Gotenberg in production, a fake in tests.
/// </summary>
public interface IPdfRenderer
{
    /// <summary>False when the renderer is not configured (no credentials); exports then answer <c>doc.export.unavailable</c>.</summary>
    bool IsAvailable { get; }

    /// <summary>
    /// Renders <see cref="PdfRenderRequest.IndexHtml"/> to A4 PDF. Throws an <c>AppException</c> with
    /// <c>doc.export.failed</c>, <c>doc.export.unavailable</c> or <c>doc.export.tooLarge</c> when it cannot.
    /// </summary>
    Task<byte[]> RenderAsync(PdfRenderRequest request, CancellationToken cancellationToken);
}

/// <param name="IndexHtml">The page: data as JSON in <c>#tk-print-data</c>, loading <c>print.css</c> and <c>print.js</c>.</param>
/// <param name="HeaderHtml">Chromium's header template, the same on every page (D-101).</param>
/// <param name="FooterHtml">Chromium's footer template; <c>pageNumber</c> and <c>totalPages</c> spans are filled in.</param>
/// <param name="Files">Further files next to the page: Canvas pictures and page images, by bundle file name.</param>
public sealed record PdfRenderRequest(string IndexHtml, string HeaderHtml, string FooterHtml, IReadOnlyList<PdfFile> Files);

public sealed record PdfFile(string Name, ReadOnlyMemory<byte> Content);

/// <summary>Signed, short-lived PDF export links (MCP <c>get_doc_export_link</c>): bound to a user and a doc, readable only by this server.</summary>
public interface IDocExportLinks
{
    string Create(DocExportGrant grant, DateTimeOffset expiresAt);

    /// <summary>The grant of a valid link, or null when it is malformed, tampered with or expired.</summary>
    DocExportGrant? Read(string token);
}

/// <param name="Version">The page or diagram version to export; null for the latest (and for folders).</param>
public sealed record DocExportGrant(Guid UserId, Guid DocId, int? Version, string SecurityStamp);
