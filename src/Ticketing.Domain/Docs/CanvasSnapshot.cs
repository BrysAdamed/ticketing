using System.Globalization;
using System.Xml;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Docs;

/// <summary>
/// The light SVG picture of one Canvas version that the editor exports on publish (D-110), shown by embeds, history and PDF.
/// It is served behind a sandbox CSP and shown in <c>&lt;img&gt;</c>, and is additionally checked here so that it holds
/// no active content even where it is inlined: well-formed XML without a DTD, an <c>svg</c> root, no scripts, foreign
/// objects or frames, no event handler attributes and only fragment, <c>data:image/</c>, <c>http(s)://</c> or app-relative
/// links.
/// </summary>
public static class CanvasSnapshot
{
    public const int MaxLength = 5_000_000;
    public const string ContentType = "image/svg+xml";

    private const string Field = "snapshot";
    private const string SvgNamespace = "http://www.w3.org/2000/svg";

    private static readonly HashSet<string> ForbiddenElements = new(StringComparer.OrdinalIgnoreCase)
    {
        "script", "foreignObject", "iframe", "embed", "object", "audio", "video", "handler", "listener",
    };

    /// <summary>Returns the trimmed SVG; throws a validation <see cref="DomainException"/> (<c>doc.snapshot.invalid</c>) when it breaks a rule.</summary>
    public static string Normalize(string? svg)
    {
        var text = svg?.Trim() ?? string.Empty;
        if (text.Length == 0)
            throw Invalid("The snapshot is empty.");
        if (text.Length > MaxLength)
            throw Invalid(string.Create(CultureInfo.InvariantCulture, $"The snapshot has {text.Length} characters; at most {MaxLength} are allowed."));

        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            IgnoreComments = true,
            IgnoreProcessingInstructions = true,
        };
        try
        {
            using var reader = XmlReader.Create(new StringReader(text), settings);
            var root = true;
            while (reader.Read())
            {
                if (reader.NodeType != XmlNodeType.Element)
                    continue;
                if (root && (reader.LocalName != "svg" || reader.NamespaceURI != SvgNamespace))
                    throw Invalid("The snapshot must be an SVG image.");
                root = false;
                if (ForbiddenElements.Contains(reader.LocalName))
                    throw Invalid($"The snapshot may not contain <{reader.LocalName}>.");
                EnsureAttributes(reader);
            }
            if (root)
                throw Invalid("The snapshot must be an SVG image.");
        }
        catch (XmlException exception)
        {
            throw Invalid($"The snapshot is not well-formed SVG: {exception.Message}");
        }
        return text;
    }

    private static void EnsureAttributes(XmlReader reader)
    {
        if (!reader.MoveToFirstAttribute())
            return;
        do
        {
            var name = reader.LocalName;
            if (name.StartsWith("on", StringComparison.OrdinalIgnoreCase))
                throw Invalid($"The snapshot may not contain event handlers ({name}).");
            if (name.Equals("href", StringComparison.OrdinalIgnoreCase) && !IsAllowedHref(reader.Value))
                throw Invalid("The snapshot may only link to http(s), app-relative, data:image or in-document URLs.");
        }
        while (reader.MoveToNextAttribute());
        reader.MoveToElement();
    }

    private static bool IsAllowedHref(string href)
    {
        var value = href.Trim();
        return value.Length == 0
            || value.StartsWith('#')
            || value.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)
            || CanvasSource.IsAllowedLink(value);
    }

    private static DomainException Invalid(string message) =>
        DomainException.Invalid(Field, DocErrors.SnapshotInvalid, message, "Send the SVG the Canvas editor exports (exportSvg()).");
}
