using Ticketing.Domain.Common;

namespace Ticketing.Domain.Attachments;

/// <summary>
/// Attachment metadata. The bytes live behind the application's attachment store (spec 4.8, D-15). An attachment belongs
/// to exactly one owner: a ticket or a doc page (D-97).
/// </summary>
public sealed class Attachment
{
    public const int FileNameMaxLength = 255;
    public const int MaxSizeBytes = 10 * 1024 * 1024;
    public const int MaxPerTicket = 50;
    public const int MaxPerDoc = 200;

    public static readonly IReadOnlySet<string> AllowedContentTypes = new HashSet<string>(StringComparer.Ordinal)
    {
        "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf",
        "text/plain", "text/csv", "application/json", "application/zip",
    };

    private Attachment()
    {
        FileName = null!;
        ContentType = null!;
        Sha256 = null!;
    }

    public Guid Id { get; private set; }

    public Guid? TicketId { get; private set; }

    public Guid? DocNodeId { get; private set; }

    public string FileName { get; private set; }

    public string ContentType { get; private set; }

    public int SizeBytes { get; private set; }

    public string Sha256 { get; private set; }

    public DateTimeOffset UploadedAt { get; private set; }

    public Guid UploadedById { get; private set; }

    public bool IsImage => ContentType.StartsWith("image/", StringComparison.Ordinal);

    public static Attachment Create(Guid ticketId, string fileName, string contentType, long sizeBytes, string sha256, Guid uploadedById, DateTimeOffset now) =>
        New(ticketId, null, fileName, contentType, sizeBytes, sha256, uploadedById, now);

    public static Attachment CreateForDoc(Guid docNodeId, string fileName, string contentType, long sizeBytes, string sha256, Guid uploadedById, DateTimeOffset now) =>
        New(null, docNodeId, fileName, contentType, sizeBytes, sha256, uploadedById, now);

    private static Attachment New(
        Guid? ticketId, Guid? docNodeId, string fileName, string contentType, long sizeBytes, string sha256, Guid uploadedById, DateTimeOffset now)
    {
        if (!AllowedContentTypes.Contains(contentType))
            throw DomainException.Invalid("file", AttachmentErrors.TypeNotAllowed, $"Files of type '{contentType}' are not allowed.");
        if (sizeBytes is < 1 or > MaxSizeBytes)
            throw DomainException.Invalid("file", AttachmentErrors.SizeInvalid, "Files must be between 1 byte and 10 MiB.");

        return new Attachment
        {
            Id = EntityId.New(),
            TicketId = ticketId,
            DocNodeId = docNodeId,
            FileName = SanitizeFileName(fileName),
            ContentType = contentType,
            SizeBytes = (int)sizeBytes,
            Sha256 = sha256,
            UploadedAt = now,
            UploadedById = uploadedById,
        };
    }

    public static string SanitizeFileName(string? fileName)
    {
        var name = (fileName ?? string.Empty).Replace('\\', '/');
        name = name[(name.LastIndexOf('/') + 1)..].Trim();
        name = new string([.. name.Where(c => !char.IsControl(c))]);
        if (name.Length == 0)
            name = "file";
        return name.Length <= FileNameMaxLength ? name : name[^FileNameMaxLength..];
    }
}
