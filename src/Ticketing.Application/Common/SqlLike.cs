namespace Ticketing.Application.Common;

public static class SqlLike
{
    /// <summary>Builds a <c>LIKE</c>/<c>ILIKE</c> pattern matching <paramref name="text"/> anywhere, with wildcards escaped.</summary>
    public static string Contains(string text) => $"%{Escape(text)}%";

    public static string StartsWith(string text) => $"{Escape(text)}%";

    private static string Escape(string text) =>
        text.Replace(@"\", @"\\", StringComparison.Ordinal)
            .Replace("%", @"\%", StringComparison.Ordinal)
            .Replace("_", @"\_", StringComparison.Ordinal);
}
