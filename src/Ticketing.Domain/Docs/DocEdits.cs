using System.Globalization;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Docs;

/// <param name="ReplaceAll">Replace every occurrence; otherwise <paramref name="OldText"/> must occur exactly once.</param>
public sealed record DocEdit(string OldText, string NewText, bool ReplaceAll = false);

/// <summary>Find/replace edits (MCP <c>edit_doc</c>): applied in order to one text, all or nothing.</summary>
public static class DocEdits
{
    public const int MaxEdits = 50;

    public static string Apply(string content, IReadOnlyList<DocEdit> edits)
    {
        var text = content;
        for (var i = 0; i < edits.Count; i++)
        {
            var oldText = DocContent.NormalizeLineEndings(edits[i].OldText ?? string.Empty);
            var newText = DocContent.NormalizeLineEndings(edits[i].NewText ?? string.Empty);
            if (oldText.Length == 0)
                throw DomainException.Invalid(
                    string.Create(CultureInfo.InvariantCulture, $"edits[{i}].oldText"), "validation.required", "oldText cannot be empty.");
            var count = Occurrences(text, oldText);
            if (count == 0)
                throw DomainException.Conflict(
                    DocErrors.EditNoMatch,
                    string.Create(CultureInfo.InvariantCulture, $"Edit {i + 1}: oldText was not found in the latest version."),
                    "Re-read the doc with get_doc; oldText must match exactly, whitespace and line breaks included.");
            if (count > 1 && !edits[i].ReplaceAll)
                throw DomainException.Conflict(
                    DocErrors.EditAmbiguous,
                    string.Create(CultureInfo.InvariantCulture, $"Edit {i + 1}: oldText occurs {count} times."),
                    "Re-read the doc with get_doc and include more surrounding text to make oldText unique, or set replaceAll.");
            text = text.Replace(oldText, newText, StringComparison.Ordinal);
        }
        return text;
    }

    private static int Occurrences(string text, string value)
    {
        var count = 0;
        for (var index = text.IndexOf(value, StringComparison.Ordinal); index >= 0; index = text.IndexOf(value, index + value.Length, StringComparison.Ordinal))
            count++;
        return count;
    }
}
