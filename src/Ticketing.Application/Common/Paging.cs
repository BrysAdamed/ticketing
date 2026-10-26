using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Ticketing.Application.Common;

/// <summary>Cursor pagination input (spec 2): <c>limit</c> defaults to 25 and is clamped to 1..100.</summary>
public sealed record PageRequest(int? Limit = null, string? Cursor = null)
{
    public const int DefaultLimit = 25;
    public const int MaxLimit = 100;

    public int Size => Math.Clamp(Limit ?? DefaultLimit, 1, MaxLimit);
}

/// <summary>The list response shape of every paged endpoint and MCP tool: <c>{ items, nextCursor }</c>.</summary>
public sealed record CursorPage<T>(IReadOnlyList<T> Items, string? NextCursor);

/// <summary>Opaque keyset cursors: base64url-encoded JSON of the last row's sort key.</summary>
public static class Cursor
{
    public static string Encode<TKey>(TKey key) =>
        Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(key)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static TKey? Decode<TKey>(string? cursor)
    {
        if (string.IsNullOrEmpty(cursor))
            return default;
        try
        {
            var base64 = cursor.Replace('-', '+').Replace('_', '/');
            base64 = base64.PadRight(base64.Length + ((4 - (base64.Length % 4)) % 4), '=');
            return JsonSerializer.Deserialize<TKey>(Encoding.UTF8.GetString(Convert.FromBase64String(base64)));
        }
        catch (Exception ex) when (ex is FormatException or JsonException)
        {
            throw new AppException(ErrorKind.Validation, AppErrors.InvalidCursor, "The cursor is invalid.",
                errors: new Dictionary<string, string[]> { ["cursor"] = ["The cursor is invalid."] });
        }
    }
}

public static class PagingExtensions
{
    /// <summary>
    /// Materializes one page of an already filtered (including the keyset condition from the decoded cursor) and ordered
    /// query, and builds the next cursor from the last row.
    /// </summary>
    public static async Task<CursorPage<T>> ToCursorPageAsync<T, TKey>(
        this IQueryable<T> orderedQuery, PageRequest page, Func<T, TKey> cursorKey, CancellationToken cancellationToken)
    {
        var rows = await orderedQuery.Take(page.Size + 1).ToListAsync(cancellationToken);
        if (rows.Count <= page.Size)
            return new CursorPage<T>(rows, null);
        rows.RemoveAt(rows.Count - 1);
        return new CursorPage<T>(rows, Cursor.Encode(cursorKey(rows[^1])));
    }

    public static CursorPage<TOut> Map<TIn, TOut>(this CursorPage<TIn> page, Func<TIn, TOut> map) =>
        new([.. page.Items.Select(map)], page.NextCursor);
}
