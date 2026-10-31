using System.Text;
using System.Text.RegularExpressions;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>
/// Reads the bookmarks of a PDF printed by Chromium (Skia writes outline items as plain objects) as paths such as
/// <c>Decisions / Storage / Use Postgres</c>, one per bookmark in file order.
/// </summary>
internal static partial class PdfOutline
{
    public static IReadOnlyList<string> Paths(byte[] pdf)
    {
        var text = Encoding.Latin1.GetString(pdf);
        var items = new Dictionary<int, (string Title, int? Parent)>();
        foreach (Match match in ObjectPattern().Matches(text))
        {
            var body = match.Groups["body"].Value;
            if (!body.Contains("/Dest", StringComparison.Ordinal))
                continue;
            var title = TitlePattern().Match(body);
            var parent = ParentPattern().Match(body);
            if (title.Success)
                items[int.Parse(match.Groups["id"].Value)] = (Decode(title.Groups["title"].Value), parent.Success ? int.Parse(parent.Groups["parent"].Value) : null);
        }

        return items.OrderBy(i => i.Key).Select(i => PathOf(i.Key)).ToList();

        string PathOf(int id)
        {
            var titles = new List<string>();
            for (int? current = id; current is { } key && items.TryGetValue(key, out var item); current = item.Parent)
                titles.Insert(0, item.Title);
            return string.Join(" / ", titles);
        }
    }

    private static string Decode(string raw)
    {
        if (raw.StartsWith('<'))
        {
            var bytes = Convert.FromHexString(raw[1..^1]);
            return bytes is [0xFE, 0xFF, ..] ? Encoding.BigEndianUnicode.GetString(bytes, 2, bytes.Length - 2) : Encoding.Latin1.GetString(bytes);
        }
        return EscapePattern().Replace(raw[1..^1], m => m.Groups["c"].Value);
    }

    [GeneratedRegex(@"(?<id>\d+) 0 obj\s*<<(?<body>.*?)>>\s*endobj", RegexOptions.Singleline)]
    private static partial Regex ObjectPattern();

    [GeneratedRegex(@"/Title\s*(?<title>\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f]*>)")]
    private static partial Regex TitlePattern();

    [GeneratedRegex(@"/Parent (?<parent>\d+) 0 R")]
    private static partial Regex ParentPattern();

    [GeneratedRegex(@"\\(?<c>.)")]
    private static partial Regex EscapePattern();
}
