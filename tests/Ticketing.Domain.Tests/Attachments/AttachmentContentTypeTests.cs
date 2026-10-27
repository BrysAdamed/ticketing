using System.Text;
using Ticketing.Domain.Attachments;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Tests.Attachments;

public sealed class AttachmentContentTypeTests
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 16];
    private static readonly byte[] Webp = [.. "RIFF"u8, 0, 0, 0, 0, .. "WEBPVP8 "u8];
    private static readonly byte[] Zip = [0x50, 0x4B, 0x03, 0x04, 20, 0];

    public static TheoryData<string?, string, byte[], string> Accepted => new()
    {
        { "image/png", "a.png", Png, "image/png" },
        { "image/jpg", "a.jpg", Jpeg, "image/jpeg" },
        { "IMAGE/JPEG; charset=binary", "a", Jpeg, "image/jpeg" },
        { "image/gif", "a.gif", [.. "GIF89a"u8, 1, 0], "image/gif" },
        { "image/webp", "a.webp", Webp, "image/webp" },
        { "application/pdf", "a.pdf", [.. "%PDF-1.4"u8], "application/pdf" },
        { "application/x-zip-compressed", "a.zip", Zip, "application/zip" },
        { null, "a.zip", Zip, "application/zip" },
        { "application/octet-stream", "photo.PNG", Png, "image/png" },
        { "text/plain; charset=utf-8", "a.txt", [.. "héllo\r\n\tworld"u8], "text/plain" },
        { "application/vnd.ms-excel", "report.csv", [.. "a;b\n1;2"u8], "text/csv" },
        { "", "data.json", [0xEF, 0xBB, 0xBF, .. "[1, {\"a\": null}]"u8], "application/json" },
        { "text/markdown", "README.md", [.. "# Title"u8], "text/plain" },
    };

    public static TheoryData<string?, string, byte[], string> Rejected => new()
    {
        { "image/svg+xml", "a.svg", [.. "<svg/>"u8], AttachmentErrors.TypeNotAllowed },
        { "text/html", "a.txt", [.. "<p>"u8], AttachmentErrors.TypeNotAllowed },
        { "application/octet-stream", "a.exe", [.. "MZ"u8], AttachmentErrors.TypeNotAllowed },
        { null, "noextension", [.. "x"u8], AttachmentErrors.TypeNotAllowed },
        { "image/png", "a.png", Jpeg, AttachmentErrors.TypeMismatch },
        { "image/jpeg", "a.jpg", [.. "<html>"u8], AttachmentErrors.TypeMismatch },
        { "application/zip", "a.zip", [.. "PK"u8], AttachmentErrors.TypeMismatch },
        { "text/plain", "a.txt", Png, AttachmentErrors.TypeMismatch },
        { "text/plain", "a.txt", [0x68, 0x00, 0x69], AttachmentErrors.TypeMismatch },
        { "text/plain", "a.txt", [0xC3, 0x28], AttachmentErrors.TypeMismatch },
        { "application/json", "a.json", [.. "{\"a\":"u8], AttachmentErrors.TypeMismatch },
        { "text/csv", "a.csv", Zip, AttachmentErrors.TypeMismatch },
    };

    [Theory]
    [MemberData(nameof(Accepted))]
    public void Allowed_types_with_matching_content_resolve(string? declared, string fileName, byte[] content, string expected)
    {
        // Act
        var resolved = AttachmentContentType.Resolve(declared, fileName, content);

        // Assert
        Assert.Equal(expected, resolved);
    }

    [Theory]
    [MemberData(nameof(Rejected))]
    public void Disallowed_types_and_mismatching_content_are_rejected(string? declared, string fileName, byte[] content, string code)
    {
        // Act
        var error = Assert.Throws<DomainException>(() => AttachmentContentType.Resolve(declared, fileName, content));

        // Assert
        Assert.Equal(code, error.Code);
        Assert.Equal("file", error.Field);
    }

    [Theory]
    [InlineData("C:\\Users\\me\\shot.png", "shot.png")]
    [InlineData("../../etc/passwd", "passwd")]
    [InlineData("  ", "file")]
    [InlineData("a\u0000b.txt", "ab.txt")]
    public void File_names_lose_paths_and_control_characters(string input, string expected) =>
        Assert.Equal(expected, Attachment.SanitizeFileName(input));

    [Fact]
    public void Text_detection_rejects_binary_signatures_even_for_text_extensions() =>
        Assert.Equal("application/pdf", AttachmentContentType.DetectBinary(Encoding.ASCII.GetBytes("%PDF-1.7")));
}
