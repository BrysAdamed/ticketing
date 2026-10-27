using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// A page, a diagram (any version) or a folder (recursively, in tree order) as an A4 PDF (docs refinement 1.11, D-111).
/// Every reader can export, Viewers and archived projects included; what the PDF shows is resolved for the caller.
/// At most 2 exports run at once and 10 wait (<c>doc.export.busy</c>); one export takes at most 2 minutes.
/// </summary>
public static class ExportDocPdf
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(120);

    /// <param name="Version">A page or diagram version; null for the latest.</param>
    /// <param name="TimeZone">IANA time zone for the dates in the PDF (<c>Europe/Warsaw</c>); UTC when missing or unknown.</param>
    /// <param name="AppUrl">The app's absolute base URL (<c>https://tickets.example.com</c>) for links that leave the PDF.</param>
    public sealed record Query(string KeyOrId, int? Version, string? TimeZone, string AppUrl) : IValidatable
    {
        /// <summary>Set for a signed export link: the only doc the link may export; any other answers <c>doc.notFound</c>.</summary>
        public Guid? LinkedDocId { get; init; }

        public void Validate(Validator validator) =>
            validator.Must(Version is null or >= 1, "version", "Versions start at 1.");
    }

    public sealed record Result(string DocKey, string FileName, byte[] Content, int Documents);

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IAttachmentStore attachments,
        IPdfRenderer renderer,
        DocExportQueue queue) : IHandler<Query, Result>
    {
        public async Task<Result> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            request.EnsureValid();
            var target = await DocLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            if (request.LinkedDocId is { } linked && linked != target.Id)
                throw DocLookup.NotFound(request.KeyOrId);
            if (!renderer.IsAvailable)
                throw Unavailable();

            using var timeout = new CancellationTokenSource(Timeout);
            using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
            try
            {
                using var slot = await queue.EnterAsync(cancellation.Token);
                var context = new DocExportContext(currentUser.DisplayName, clock.Now, Zone(request.TimeZone), request.AppUrl.TrimEnd('/'));
                var job = await DocPrint.BuildAsync(db, access, attachments, target, request.Version, context, cancellation.Token);
                var pdf = await renderer.RenderAsync(job.Request, cancellation.Token);
                if (pdf.LongLength > DocPrint.MaxBytes)
                    throw DocPrint.TooLarge("The PDF would be larger than 100 MB. Export a smaller folder.");
                return new Result(target.Key, job.FileName, pdf, job.Documents);
            }
            catch (OperationCanceledException) when (timeout.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
            {
                throw new AppException(
                    ErrorKind.Unavailable, DocErrors.ExportTimeout, "The PDF export took longer than 2 minutes and was stopped.",
                    "Export a smaller folder, or try again later.");
            }
        }

        private static TimeZoneInfo Zone(string? id) =>
            !string.IsNullOrWhiteSpace(id) && TimeZoneInfo.TryFindSystemTimeZoneById(id.Trim(), out var zone) ? zone : TimeZoneInfo.Utc;
    }

    public static AppException Unavailable() =>
        new(ErrorKind.Unavailable, DocErrors.ExportUnavailable, "PDF export is not set up on this server.",
            "An administrator sets PDF_RENDERER_PASSWORD in .env and restarts the stack (see docs/development/backend.md).");
}
