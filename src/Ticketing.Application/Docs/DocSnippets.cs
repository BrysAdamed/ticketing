using System.Text;

namespace Ticketing.Application.Docs;

/// <summary>A search snippet: plain text (never HTML) and the ranges of it that matched, as UTF-16 offsets.</summary>
public sealed record DocSnippetDto(string Text, IReadOnlyList<TextRangeDto> Highlights);

public sealed record TextRangeDto(int Start, int Length);

/// <summary>
/// Turns the output of <c>ts_headline</c> (matches wrapped in <see cref="StartMark"/> and <see cref="StopMark"/>) or the
/// start of a doc into a <see cref="DocSnippetDto"/>: whitespace collapsed, markdown emphasis and heading marks dropped,
/// at most <see cref="MaxLength"/> characters.
/// </summary>
internal static class DocSnippets
{
    public const char StartMark = '\u0002';
    public const char StopMark = '\u0003';
    public const int MaxLength = 240;

    /// <summary>The <c>ts_headline</c> options: 12..30 words around the best match, short words kept.</summary>
    public const string HeadlineOptions = "StartSel=\u0002, StopSel=\u0003, MaxWords=30, MinWords=12, ShortWord=0";

    /// <summary>How much of a doc's start is read for a snippet when there is no text to match.</summary>
    public const int PreviewSourceLength = 600;

    public static DocSnippetDto? Build(string? source)
    {
        if (string.IsNullOrEmpty(source))
            return null;

        var text = new StringBuilder(Math.Min(source.Length, MaxLength + 1));
        var highlights = new List<TextRangeDto>();
        int? start = null;
        var open = false;
        var space = false;
        foreach (var c in source)
        {
            if (c == StartMark)
            {
                open = true;
                start = null;
                continue;
            }
            if (c == StopMark)
            {
                Close(highlights, start, text.Length);
                open = false;
                start = null;
                continue;
            }
            if (char.IsWhiteSpace(c) || char.IsControl(c))
            {
                space = text.Length > 0;
                continue;
            }
            if (c is '#' or '*' or '`' or '|' or '~')
                continue;
            if (text.Length >= MaxLength)
                return Truncated(text, highlights);
            if (space)
            {
                text.Append(' ');
                space = false;
            }
            if (open && start is null)
                start = text.Length;
            text.Append(c);
        }
        if (open)
            Close(highlights, start, text.Length);
        return text.Length == 0 ? null : new DocSnippetDto(text.ToString(), highlights);
    }

    private static DocSnippetDto Truncated(StringBuilder text, List<TextRangeDto> highlights)
    {
        var cut = text.ToString().LastIndexOf(' ');
        var length = cut > MaxLength / 2 ? cut : text.Length;
        var kept = highlights
            .Where(h => h.Start < length)
            .Select(h => h with { Length = Math.Min(h.Length, length - h.Start) })
            .ToList();
        return new DocSnippetDto(text.ToString(0, length) + "…", kept);
    }

    private static void Close(List<TextRangeDto> highlights, int? start, int end)
    {
        if (start is not { } s || end <= s)
            return;
        if (highlights.Count > 0 && highlights[^1].Start + highlights[^1].Length == s)
            highlights[^1] = highlights[^1] with { Length = end - highlights[^1].Start };
        else
            highlights.Add(new TextRangeDto(s, end - s));
    }
}
