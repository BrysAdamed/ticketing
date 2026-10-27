namespace Ticketing.Application.Common;

public static class SqlLike
{
    /// <summary>Longer input is cut to this length, so a huge pattern cannot make every row comparison expensive.</summary>
    public const int MaxTextLength = 500;

    /// <summary>Builds a <c>LIKE</c>/<c>ILIKE</c> pattern matching <paramref name="text"/> anywhere, with wildcards escaped.</summary>
    public static string Contains(string text) => $"%{Escape(text)}%";

    public static string StartsWith(string text) => $"{Escape(text)}%";

    private static string Escape(string text) =>
        (text.Length > MaxTextLength ? text[..MaxTextLength] : text)
            .Replace(@"\", @"\\", StringComparison.Ordinal)
            .Replace("%", @"\%", StringComparison.Ordinal)
            .Replace("_", @"\_", StringComparison.Ordinal);
}
