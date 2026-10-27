namespace Ticketing.Domain.Docs;

/// <summary>How many lines a version added and removed compared with the version before it.</summary>
public readonly record struct DocLineChanges(int Added, int Removed);

/// <summary>
/// Counts the lines of a shortest line diff (Myers) between two texts, the "+12 −3" of a history row. Lines are split on
/// <c>\n</c> (a trailing newline ends the last line, <c>\r\n</c> counts as <c>\n</c>). Common head and tail lines are
/// skipped first, so typical edits of large pages stay cheap.
/// </summary>
public static class DocLineDiff
{
    public static DocLineChanges Count(string? before, string? after)
    {
        var ids = new Dictionary<string, int>(StringComparer.Ordinal);
        var a = Lines(before, ids);
        var b = Lines(after, ids);

        var start = 0;
        while (start < a.Length && start < b.Length && a[start] == b[start])
            start++;
        var endA = a.Length;
        var endB = b.Length;
        while (endA > start && endB > start && a[endA - 1] == b[endB - 1])
        {
            endA--;
            endB--;
        }

        var n = endA - start;
        var m = endB - start;
        if (n == 0 || m == 0)
            return new DocLineChanges(m, n);

        var edits = ShortestEditDistance(a.AsSpan(start, n), b.AsSpan(start, m));
        var common = (n + m - edits) / 2;
        return new DocLineChanges(m - common, n - common);
    }

    private static int[] Lines(string? text, Dictionary<string, int> ids)
    {
        if (string.IsNullOrEmpty(text))
            return [];
        var lines = text.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
        var count = lines[^1].Length == 0 ? lines.Length - 1 : lines.Length;
        var result = new int[count];
        for (var i = 0; i < count; i++)
        {
            if (!ids.TryGetValue(lines[i], out var id))
            {
                id = ids.Count;
                ids.Add(lines[i], id);
            }
            result[i] = id;
        }
        return result;
    }

    /// <summary>Myers' O((N+M)·D) greedy forward search; returns D, the number of inserted plus deleted lines.</summary>
    private static int ShortestEditDistance(ReadOnlySpan<int> a, ReadOnlySpan<int> b)
    {
        var n = a.Length;
        var m = b.Length;
        var max = n + m;
        var v = new int[(2 * max) + 2];
        for (var d = 0; d <= max; d++)
        {
            for (var k = -d; k <= d; k += 2)
            {
                var x = k == -d || (k != d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
                var y = x - k;
                while (x < n && y < m && a[x] == b[y])
                {
                    x++;
                    y++;
                }
                v[max + k] = x;
                if (x >= n && y >= m)
                    return d;
            }
        }
        return max;
    }
}
