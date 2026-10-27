using System.Globalization;
using System.Text;

namespace Ticketing.Domain.Docs;

/// <summary>
/// Path addressing (<c>Architecture/ADRs/0001 Use Postgres</c>): titles joined by <c>/</c>; a literal <c>/</c> in a title is
/// written <c>\/</c> and a backslash <c>\\</c>. Lookup is case-insensitive through the sibling-unique titles. Also the
/// cosmetic URL slug.
/// </summary>
public static class DocPaths
{
    public const int SlugMaxLength = 80;

    public static string Format(IEnumerable<string> titles) => string.Join('/', titles.Select(Escape));

    public static string Escape(string title) =>
        title.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("/", "\\/", StringComparison.Ordinal);

    /// <summary>The title segments of <paramref name="path"/>, or null when it is empty or malformed (empty segment, dangling escape).</summary>
    public static IReadOnlyList<string>? Parse(string? path)
    {
        var text = path?.Trim().Trim('/');
        if (string.IsNullOrEmpty(text))
            return null;

        var segments = new List<string>();
        var current = new StringBuilder();
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (c == '\\')
            {
                if (i + 1 >= text.Length || text[i + 1] is not ('/' or '\\'))
                    return null;
                current.Append(text[++i]);
            }
            else if (c == '/')
            {
                if (!TryAdd(segments, current))
                    return null;
            }
            else
            {
                current.Append(c);
            }
        }
        return TryAdd(segments, current) ? segments : null;
    }

    /// <summary>Lower-case ASCII words joined by dashes, for the cosmetic part of a doc URL; never empty.</summary>
    public static string Slug(string title)
    {
        var decomposed = title.Normalize(NormalizationForm.FormD);
        var slug = new StringBuilder(Math.Min(decomposed.Length, SlugMaxLength));
        var dash = false;
        foreach (var c in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark)
                continue;
            if (char.IsAsciiLetterOrDigit(c))
            {
                if (dash && slug.Length > 0)
                    slug.Append('-');
                slug.Append(char.ToLowerInvariant(c));
                dash = false;
            }
            else
            {
                dash = true;
            }
            if (slug.Length >= SlugMaxLength)
                break;
        }
        return slug.Length == 0 ? "doc" : slug.ToString().TrimEnd('-');
    }

    private static bool TryAdd(List<string> segments, StringBuilder current)
    {
        var segment = current.ToString().Trim();
        current.Clear();
        if (segment.Length == 0)
            return false;
        segments.Add(segment);
        return true;
    }
}
