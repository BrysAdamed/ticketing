using System.Globalization;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Docs;

/// <summary>Content rules shared by published docs and drafts: line endings become <c>\n</c>, null becomes empty, per-kind size limits.</summary>
public static class DocContent
{
    public static string Normalize(string? content, DocKind kind, DiagramFormat? format)
    {
        if (kind == DocKind.Folder)
            throw DomainException.Conflict(DocErrors.KindUnsupported, "Folders have no content.", "Pass a page or diagram key.");
        var text = NormalizeLineEndings(content ?? string.Empty);
        var max = DocNode.ContentMaxLength(kind, format);
        if (text.Length > max)
            throw DomainException.Invalid(
                "content", DocErrors.ContentTooLong,
                string.Create(CultureInfo.InvariantCulture, $"The content has {text.Length} characters; a {Describe(kind, format)} can have at most {max}."),
                kind == DocKind.Page ? "Split the page into several pages." : null);
        return text;
    }

    public static string NormalizeLineEndings(string text) =>
        text.Contains('\r', StringComparison.Ordinal) ? text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n') : text;

    private static string Describe(DocKind kind, DiagramFormat? format) =>
        kind == DocKind.Page ? "page" : $"{format} diagram";
}
