using System.Globalization;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Docs;

/// <summary>
/// Doc titles: a single line of 1..200 characters, unique among non-deleted siblings ignoring case (path addressing relies
/// on it). <see cref="Comparer"/> and <see cref="Key"/> mirror the database's <c>lower(title)</c> unique index.
/// </summary>
public static class DocTitles
{
    private const string ReservedFileNameChars = "\\/:*?\"<>|";

    public static StringComparer Comparer => StringComparer.OrdinalIgnoreCase;

    public static string Normalize(string? title) => Text.SingleLine(title, "title", DocNode.TitleMaxLength);

    public static string Key(string title) => title.ToLowerInvariant();

    public static DomainException Duplicate(string title) =>
        DomainException.Conflict(
            DocErrors.TitleDuplicate,
            $"A doc named '{title}' already exists in this folder.",
            "Pick another title; titles are unique within a folder, ignoring case.");

    /// <summary>
    /// A download file name for a doc: the title without path, reserved and control characters, or <paramref name="fallback"/>
    /// (the key) when nothing is left, followed by <paramref name="extension"/> (for example <c>.md</c>).
    /// </summary>
    public static string FileName(string title, string fallback, string extension)
    {
        var name = new string([.. title.Select(c => char.IsControl(c) || ReservedFileNameChars.Contains(c) ? ' ' : c)]);
        name = string.Join(' ', name.Split(' ', StringSplitOptions.RemoveEmptyEntries)).Trim('.', ' ');
        return (name.Length == 0 ? fallback : name) + extension;
    }

    /// <summary>"Copy of X", then "Copy of X (2)", "Copy of X (3)"... avoiding <paramref name="taken"/>.</summary>
    public static string CopyOf(string title, IReadOnlySet<string> taken)
    {
        var copy = Fit($"Copy of {title}", string.Empty);
        return taken.Contains(copy) ? WithSuffix(copy, taken, n => string.Create(CultureInfo.InvariantCulture, $" ({n})"), first: 2) : copy;
    }

    /// <summary><paramref name="title"/> when free, otherwise "X (restored)", "X (restored 2)"...</summary>
    public static string Restored(string title, IReadOnlySet<string> taken) =>
        taken.Contains(title)
            ? WithSuffix(title, taken, n => n == 1 ? " (restored)" : string.Create(CultureInfo.InvariantCulture, $" (restored {n})"), first: 1)
            : title;

    private static string WithSuffix(string title, IReadOnlySet<string> taken, Func<int, string> suffix, int first)
    {
        for (var n = first; ; n++)
        {
            var candidate = Fit(title, suffix(n));
            if (!taken.Contains(candidate))
                return candidate;
        }
    }

    private static string Fit(string title, string suffix) =>
        title.Length + suffix.Length <= DocNode.TitleMaxLength ? title + suffix : title[..(DocNode.TitleMaxLength - suffix.Length)].TrimEnd() + suffix;
}
