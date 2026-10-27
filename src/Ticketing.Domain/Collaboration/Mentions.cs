using System.Text.RegularExpressions;

namespace Ticketing.Domain.Collaboration;

/// <summary>A stored mention, <c>@[Name](user:id)</c>, found at <see cref="Start"/> in a markdown text.</summary>
public readonly record struct MentionToken(Guid UserId, string Name, int Start, int Length);

/// <summary>An <c>@email</c> mention as clients may write it, before the server turns it into a <see cref="MentionToken"/>.</summary>
public readonly record struct EmailMention(string Email, int Start, int Length);

/// <summary>
/// The mention syntax of ticket descriptions and comments (D-95). The id is authoritative and the name only a fallback, so a
/// stored mention survives renames. Mentions inside inline code spans and fenced code blocks are not mentions; the web client
/// applies the same rules.
/// </summary>
public static partial class Mentions
{
    private const string FallbackName = "user";

    public static IReadOnlyList<MentionToken> Parse(string? markdown)
    {
        if (string.IsNullOrEmpty(markdown) || !markdown.Contains("](user:", StringComparison.Ordinal))
            return [];

        var code = CodeRanges(markdown);
        return [.. TokenPattern().Matches(markdown)
            .Where(m => !Overlaps(code, m.Index, m.Length))
            .Select(m => new MentionToken(Guid.Parse(m.Groups[2].Value), m.Groups[1].Value, m.Index, m.Length))];
    }

    public static IReadOnlyList<EmailMention> ParseEmails(string? markdown)
    {
        if (string.IsNullOrEmpty(markdown) || !markdown.Contains('@', StringComparison.Ordinal))
            return [];

        var skipped = CodeRanges(markdown);
        skipped.AddRange(Parse(markdown).Select(t => (t.Start, t.Start + t.Length)));
        return [.. EmailPattern().Matches(markdown)
            .Where(m => !Overlaps(skipped, m.Index, m.Length))
            .Select(m => new EmailMention(m.Groups[1].Value, m.Index, m.Length))];
    }

    /// <summary>The distinct users mentioned in <paramref name="markdown"/>, in order of first appearance.</summary>
    public static IReadOnlyList<Guid> UserIds(string? markdown) => [.. Parse(markdown).Select(t => t.UserId).Distinct()];

    /// <summary>Users mentioned in <paramref name="current"/> but not in <paramref name="previous"/>.</summary>
    public static IReadOnlyList<Guid> NewlyMentioned(string? previous, string? current)
    {
        var before = UserIds(previous).ToHashSet();
        return [.. UserIds(current).Where(id => !before.Contains(id))];
    }

    public static string Format(Guid userId, string? displayName)
    {
        var name = new string([.. (displayName ?? string.Empty).Where(c => c is not ('[' or ']' or '(' or ')' or '\r' or '\n'))]).Trim();
        return $"@[{(name.Length == 0 ? FallbackName : name)}](user:{userId:D})";
    }

    private static bool Overlaps(List<(int Start, int End)> ranges, int start, int length) =>
        ranges.Exists(r => start < r.End && r.Start < start + length);

    /// <summary>Fenced code blocks (found line by line), then inline code spans in the text between them.</summary>
    private static List<(int Start, int End)> CodeRanges(string text)
    {
        var ranges = new List<(int Start, int End)>();
        var segmentStart = 0;
        var fenceStart = -1;
        var fenceMarker = '\0';
        var fenceLength = 0;
        var position = 0;
        while (position < text.Length)
        {
            var newline = text.IndexOf('\n', position);
            var lineEnd = newline < 0 ? text.Length : newline;
            var next = newline < 0 ? text.Length : newline + 1;
            var line = text.AsSpan(position, lineEnd - position);
            if (fenceStart < 0)
            {
                if (Fence(line, out var marker, out var length, out _))
                {
                    InlineCode(text, segmentStart, position, ranges);
                    (fenceStart, fenceMarker, fenceLength) = (position, marker, length);
                }
            }
            else if (Fence(line, out var marker, out var length, out var bare) && bare && marker == fenceMarker && length >= fenceLength)
            {
                ranges.Add((fenceStart, next));
                fenceStart = -1;
                segmentStart = next;
            }
            position = next;
        }

        if (fenceStart >= 0)
            ranges.Add((fenceStart, text.Length));
        else
            InlineCode(text, segmentStart, text.Length, ranges);
        return ranges;
    }

    private static bool Fence(ReadOnlySpan<char> line, out char marker, out int length, out bool bare)
    {
        var indent = 0;
        while (indent < 3 && indent < line.Length && line[indent] == ' ')
            indent++;
        marker = indent < line.Length ? line[indent] : '\0';
        length = 0;
        bare = false;
        if (marker is not ('`' or '~'))
            return false;
        while (indent + length < line.Length && line[indent + length] == marker)
            length++;
        bare = line[(indent + length)..].IsWhiteSpace();
        return length >= 3;
    }

    private static void InlineCode(string text, int from, int to, List<(int Start, int End)> ranges)
    {
        var i = from;
        while (i < to)
        {
            if (text[i] != '`')
            {
                i++;
                continue;
            }
            var run = RunLength(text, i, to);
            var close = FindRun(text, i + run, to, run);
            if (close < 0)
            {
                i += run;
                continue;
            }
            ranges.Add((i, close + run));
            i = close + run;
        }
    }

    private static int FindRun(string text, int from, int to, int length)
    {
        var i = from;
        while (i < to)
        {
            if (text[i] != '`')
            {
                i++;
                continue;
            }
            var run = RunLength(text, i, to);
            if (run == length)
                return i;
            i += run;
        }
        return -1;
    }

    private static int RunLength(string text, int start, int to)
    {
        var end = start;
        while (end < to && text[end] == '`')
            end++;
        return end - start;
    }

    [GeneratedRegex(@"@\[([^\[\]\r\n]+)\]\(user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)", RegexOptions.CultureInvariant)]
    private static partial Regex TokenPattern();

    [GeneratedRegex(@"(?<![\w@.+%-])@([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?![\w@-])", RegexOptions.CultureInvariant)]
    private static partial Regex EmailPattern();
}
