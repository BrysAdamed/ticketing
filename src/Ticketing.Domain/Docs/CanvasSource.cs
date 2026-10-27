using System.Globalization;
using System.Text.Json;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Docs;

/// <summary>
/// The publish rules of a Canvas diagram's source, an Excalidraw scene (spec 1.8, D-110): a JSON object of type
/// <c>excalidraw</c> with an <c>elements</c> array of at most <see cref="MaxElements"/>, no embedded files or images, no web
/// embeds, and element links that are <c>http(s)://</c> or app-relative. Blank source is an empty canvas.
/// </summary>
public static class CanvasSource
{
    public const int MaxElements = 10_000;

    private const string Field = "content";

    /// <summary>Checks <paramref name="source"/> against the rules and returns its outline; throws a validation <see cref="DomainException"/>.</summary>
    public static CanvasOutline Validate(string? source)
    {
        if (string.IsNullOrWhiteSpace(source))
            return CanvasOutline.Empty;
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(source);
        }
        catch (JsonException)
        {
            throw Invalid("The Canvas source is not valid JSON.");
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "excalidraw"
                || !root.TryGetProperty("elements", out var elements) || elements.ValueKind != JsonValueKind.Array)
                throw Invalid("The Canvas source is not an Excalidraw scene: an object with \"type\": \"excalidraw\" and an \"elements\" array.");

            EnsureNoFiles(root);
            var count = elements.GetArrayLength();
            if (count > MaxElements)
                throw DomainException.Invalid(
                    Field, DocErrors.DiagramTooManyElements,
                    string.Create(CultureInfo.InvariantCulture, $"The canvas has {count} elements; a Canvas diagram can have at most {MaxElements}."),
                    "Split the drawing into several diagrams.");
            foreach (var element in elements.EnumerateArray())
                EnsureAllowed(element);
            return CanvasOutline.FromElements(elements);
        }
    }

    /// <summary>True for <c>http(s)://</c> URLs and app-relative paths (<c>/projects/WEB/docs/WEB-D-3</c>), the only element links allowed.</summary>
    public static bool IsAllowedLink(string link)
    {
        var value = link.Trim();
        if (value.StartsWith('/'))
            return !value.StartsWith("//", StringComparison.Ordinal) && !value.Contains('\\', StringComparison.Ordinal);
        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }

    private static void EnsureNoFiles(JsonElement root)
    {
        if (!root.TryGetProperty("files", out var files) || files.ValueKind == JsonValueKind.Null)
            return;
        if (files.ValueKind != JsonValueKind.Object || files.EnumerateObject().Any())
            throw EmbeddedFiles();
    }

    private static void EnsureAllowed(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
            throw Invalid("Every Canvas element must be a JSON object.");
        var type = element.TryGetProperty("type", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        switch (type)
        {
            case "image":
                throw EmbeddedFiles();
            case "embeddable" or "iframe":
                throw Invalid("Canvas diagrams cannot embed web pages.");
        }

        if (element.TryGetProperty("link", out var link) && link.ValueKind == JsonValueKind.String
            && link.GetString() is { Length: > 0 } url && !IsAllowedLink(url))
            throw Invalid($"The element link '{Shorten(url)}' is not allowed; links must start with http://, https:// or / (a link inside the app).");
    }

    private static DomainException Invalid(string message) =>
        DomainException.Invalid(Field, DocErrors.DiagramInvalidSource, message, "Store Excalidraw JSON as the editor saves it (serializeAsJSON, 'database').");

    private static DomainException EmbeddedFiles() =>
        DomainException.Invalid(
            Field, DocErrors.DiagramEmbeddedFiles, "Canvas diagrams cannot contain images or other embedded files.", "Images go in pages.");

    private static string Shorten(string text) => text.Length <= 80 ? text : string.Concat(text.AsSpan(0, 80), "…");
}
