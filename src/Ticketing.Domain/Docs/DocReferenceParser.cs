using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Ticketing.Domain.Docs;

/// <summary>A ticket or doc key found in content, split into project key and number.</summary>
public sealed record DocKeyReference(string ProjectKey, int Number);

/// <summary>The distinct keys a doc's content mentions, in order of first appearance; embeds are also in <see cref="Docs"/>.</summary>
public sealed record DocContentKeys(IReadOnlyList<DocKeyReference> Tickets, IReadOnlyList<DocKeyReference> Docs, IReadOnlyList<DocKeyReference> Embeds)
{
    public static readonly DocContentKeys None = new([], [], []);
}

/// <summary>
/// Finds the ticket keys (<c>WEB-42</c>), doc keys (<c>WEB-D-12</c>, also as <c>[text](WEB-D-12)</c>) and diagram embeds
/// (<c>![caption](WEB-D-7)</c>) in a page's markdown the way the web renderer links them: keys are upper case, and keys inside
/// code spans, fenced or indented code blocks and URLs are ignored. A Mermaid source is scanned as plain text.
/// </summary>
public static partial class DocReferenceParser
{
    /// <summary>At most this many distinct tickets and this many distinct docs are taken from one content.</summary>
    public const int MaxKeysPerKind = 500;

    public static DocContentKeys Parse(string? content, DocKind kind, DiagramFormat? format)
    {
        if (string.IsNullOrEmpty(content))
            return DocContentKeys.None;
        return kind switch
        {
            DocKind.Page => Scan(StripCode(content), embeds: true),
            DocKind.Diagram when format == DiagramFormat.Mermaid => Scan(content, embeds: false),
            _ => DocContentKeys.None,
        };
    }

    private static DocContentKeys Scan(string text, bool embeds)
    {
        text = UrlPattern().Replace(text, " ");
        var embedKeys = embeds ? Distinct(EmbedPattern().Matches(text)) : [];
        return new DocContentKeys(Distinct(TicketKeyPattern().Matches(text)), Distinct(DocKeyPattern().Matches(text)), embedKeys);
    }

    private static List<DocKeyReference> Distinct(MatchCollection matches)
    {
        var seen = new HashSet<DocKeyReference>();
        var result = new List<DocKeyReference>();
        foreach (Match match in matches)
        {
            if (result.Count == MaxKeysPerKind)
                break;
            if (!int.TryParse(match.Groups["n"].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture, out var number) || number < 1)
                continue;
            var key = new DocKeyReference(match.Groups["p"].Value, number);
            if (seen.Add(key))
                result.Add(key);
        }
        return result;
    }

    /// <summary>The markdown without fenced and indented code blocks and without code spans (blocks become blank lines).</summary>
    internal static string StripCode(string markdown)
    {
        var lines = markdown.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
        var kept = new StringBuilder(markdown.Length);
        char fenceChar = default;
        var fenceLength = 0;
        var previousBlank = true;
        var previousIndentedCode = false;
        var inList = false;
        foreach (var line in lines)
        {
            var blank = string.IsNullOrWhiteSpace(line);
            if (fenceLength > 0)
            {
                var close = FencePattern().Match(line);
                if (close.Success && close.Groups[1].Value[0] == fenceChar && close.Groups[1].Length >= fenceLength && string.IsNullOrWhiteSpace(close.Groups[2].Value))
                    fenceLength = 0;
                kept.Append('\n');
                continue;
            }

            var open = FencePattern().Match(line);
            if (open.Success && !(open.Groups[1].Value[0] == '`' && open.Groups[2].Value.Contains('`', StringComparison.Ordinal)))
            {
                fenceChar = open.Groups[1].Value[0];
                fenceLength = open.Groups[1].Length;
                kept.Append('\n');
                previousBlank = false;
                previousIndentedCode = false;
                continue;
            }

            var indented = line.StartsWith("    ", StringComparison.Ordinal) || line.StartsWith('\t');
            if (!blank && indented && !inList && (previousBlank || previousIndentedCode))
            {
                previousIndentedCode = true;
                previousBlank = false;
                kept.Append('\n');
                continue;
            }

            if (!blank && !indented)
                inList = ListItemPattern().IsMatch(line);
            previousIndentedCode = previousIndentedCode && blank;
            previousBlank = blank;
            kept.Append(line).Append('\n');
        }

        var blocks = BlankLinePattern().Split(kept.ToString());
        return string.Join("\n\n", blocks.Select(block => CodeSpanPattern().Replace(block, " ")));
    }

    [GeneratedRegex(@"^\s*(?:>\s?)*\s*(`{3,}|~{3,})(.*)$", RegexOptions.CultureInvariant)]
    private static partial Regex FencePattern();

    [GeneratedRegex(@"^ {0,3}(?:>\s?)*\s*(?:[-+*]|\d{1,9}[.)])(?:\s|$)", RegexOptions.CultureInvariant)]
    private static partial Regex ListItemPattern();

    [GeneratedRegex(@"\n[ \t]*\n", RegexOptions.CultureInvariant)]
    private static partial Regex BlankLinePattern();

    [GeneratedRegex(@"(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)", RegexOptions.CultureInvariant)]
    private static partial Regex CodeSpanPattern();

    [GeneratedRegex(@"(?:https?|ftp|mailto):[^\s<>()\[\]]+|www\.[^\s<>()\[\]]+", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex UrlPattern();

    [GeneratedRegex(@"!\[[^\]\n]*\]\(\s*<?(?<p>[A-Z][A-Z0-9]{1,9})-D-(?<n>\d{1,9})>?(?:\s+""[^""\n]*"")?\s*\)", RegexOptions.CultureInvariant)]
    private static partial Regex EmbedPattern();

    [GeneratedRegex(@"(?<![A-Za-z0-9-])\b(?<p>[A-Z][A-Z0-9]{1,9})-(?<n>\d{1,9})\b", RegexOptions.CultureInvariant)]
    private static partial Regex TicketKeyPattern();

    [GeneratedRegex(@"(?<![A-Za-z0-9-])\b(?<p>[A-Z][A-Z0-9]{1,9})-D-(?<n>\d{1,9})\b", RegexOptions.CultureInvariant)]
    private static partial Regex DocKeyPattern();
}
