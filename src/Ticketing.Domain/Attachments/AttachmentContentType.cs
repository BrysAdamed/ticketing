using System.Text.Unicode;
using System.Text.Json;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Attachments;

/// <summary>
/// Decides an upload's content type (spec 4.8): the client's declared type (or, when it is generic, the file extension)
/// must be on the allow-list, and the bytes must agree with it. Binary types are checked by their signature; text types
/// must be UTF-8 without binary signatures, and JSON must parse. SVG and HTML are never accepted.
/// </summary>
public static class AttachmentContentType
{
    private static readonly IReadOnlyDictionary<string, string> Aliases = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["image/jpg"] = "image/jpeg",
        ["image/pjpeg"] = "image/jpeg",
        ["application/x-zip-compressed"] = "application/zip",
        ["application/zip-compressed"] = "application/zip",
        ["application/csv"] = "text/csv",
        ["text/x-csv"] = "text/csv",
        ["text/markdown"] = "text/plain",
        ["text/x-markdown"] = "text/plain",
        ["text/x-log"] = "text/plain",
    };

    private static readonly IReadOnlySet<string> Generic = new HashSet<string>(StringComparer.Ordinal)
    {
        string.Empty, "application/octet-stream", "binary/octet-stream", "application/vnd.ms-excel",
    };

    private static readonly IReadOnlyDictionary<string, string> ByExtension = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".gif"] = "image/gif",
        [".webp"] = "image/webp",
        [".pdf"] = "application/pdf",
        [".txt"] = "text/plain",
        [".log"] = "text/plain",
        [".md"] = "text/plain",
        [".csv"] = "text/csv",
        [".json"] = "application/json",
        [".zip"] = "application/zip",
    };

    private static readonly IReadOnlySet<string> TextTypes = new HashSet<string>(StringComparer.Ordinal) { "text/plain", "text/csv", "application/json" };

    public static bool IsText(string contentType) => TextTypes.Contains(contentType);

    /// <summary>Returns the allow-listed content type to store, or throws <c>attachment.type.notAllowed</c> / <c>attachment.type.mismatch</c>.</summary>
    public static string Resolve(string? declaredContentType, string fileName, ReadOnlySpan<byte> content)
    {
        var claimed = Claimed(declaredContentType, fileName);
        var detected = DetectBinary(content);
        if (IsText(claimed))
        {
            if (detected is not null || !IsUtf8Text(content) || (claimed == "application/json" && !IsJson(content)))
                throw Mismatch(claimed);
        }
        else if (detected != claimed)
        {
            throw Mismatch(claimed);
        }
        return claimed;
    }

    /// <summary>The binary type whose signature starts <paramref name="content"/>, or null.</summary>
    public static string? DetectBinary(ReadOnlySpan<byte> content)
    {
        if (content.StartsWith((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
            return "image/png";
        if (content.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF]))
            return "image/jpeg";
        if (content.StartsWith("GIF87a"u8) || content.StartsWith("GIF89a"u8))
            return "image/gif";
        if (content.Length >= 12 && content.StartsWith("RIFF"u8) && content[8..12].SequenceEqual("WEBP"u8))
            return "image/webp";
        if (content.StartsWith("%PDF-"u8))
            return "application/pdf";
        if (content.StartsWith((ReadOnlySpan<byte>)[0x50, 0x4B, 0x03, 0x04]) || content.StartsWith((ReadOnlySpan<byte>)[0x50, 0x4B, 0x05, 0x06]))
            return "application/zip";
        return null;
    }

    private static string Claimed(string? declaredContentType, string fileName)
    {
        var declared = (declaredContentType ?? string.Empty).Split(';')[0].Trim().ToLowerInvariant();
        declared = Aliases.GetValueOrDefault(declared, declared);
        if (Attachment.AllowedContentTypes.Contains(declared))
            return declared;
        if (Generic.Contains(declared) && ByExtension.TryGetValue(Path.GetExtension(fileName), out var byExtension))
            return byExtension;
        var shown = declared.Length > 0 && !Generic.Contains(declared) ? declared : Path.GetExtension(fileName);
        throw DomainException.Invalid(
            "file", AttachmentErrors.TypeNotAllowed, $"Files of type '{(shown.Length > 0 ? shown : "unknown")}' are not allowed.",
            "Allowed: PNG, JPEG, GIF, WebP, PDF, plain text, CSV, JSON and ZIP.");
    }

    private static bool IsUtf8Text(ReadOnlySpan<byte> content)
    {
        if (!Utf8.IsValid(content))
            return false;
        foreach (var b in content)
        {
            if (b < 0x20 && b is not ((byte)'\t' or (byte)'\n' or (byte)'\r' or 0x0C))
                return false;
        }
        return true;
    }

    private static bool IsJson(ReadOnlySpan<byte> content)
    {
        try
        {
            var reader = new Utf8JsonReader(content.StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF]) ? content[3..] : content, new JsonReaderOptions { CommentHandling = JsonCommentHandling.Skip });
            while (reader.Read())
            {
            }
            return reader.BytesConsumed > 0;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static DomainException Mismatch(string claimed) =>
        DomainException.Invalid("file", AttachmentErrors.TypeMismatch, $"The file content does not match its type '{claimed}'.",
            "Upload the original file; renamed or corrupted files are rejected.");
}
