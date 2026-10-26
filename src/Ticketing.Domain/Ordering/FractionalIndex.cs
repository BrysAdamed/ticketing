namespace Ticketing.Domain.Ordering;

/// <summary>
/// Lexicographically sortable rank keys: a C# port of the <c>fractional-indexing</c> npm package (v4, base62 digits),
/// so the frontend can compute identical keys for optimistic previews. Keys compare ordinally (Postgres <c>COLLATE "C"</c>).
/// Unlike the npm package, <see cref="KeyBetween"/> throws when <c>a &gt;= b</c> instead of swapping.
/// </summary>
public static class FractionalIndex
{
    private const string Digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    private const string IntDigits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    private const char Zero = '0';
    private static readonly string SmallestInteger = "A" + new string(Zero, 26);

    public static string KeyBetween(string? a, string? b)
    {
        if (a is not null)
            ValidateOrderKey(a);
        if (b is not null)
            ValidateOrderKey(b);
        if (a is not null && b is not null && string.CompareOrdinal(a, b) >= 0)
            throw new ArgumentException($"{a} >= {b}");

        if (a is null)
        {
            if (b is null)
                return "a" + Zero;
            var ib = IntegerPart(b);
            var fb = b[ib.Length..];
            if (ib == SmallestInteger)
                return ib + Midpoint(string.Empty, fb);
            if (string.CompareOrdinal(ib, b) < 0)
                return ib;
            return DecrementInteger(ib) ?? throw new InvalidOperationException("Cannot decrement any more.");
        }

        if (b is null)
        {
            var ia = IntegerPart(a);
            return IncrementInteger(ia) ?? ia + Midpoint(a[ia.Length..], null);
        }

        var intA = IntegerPart(a);
        var intB = IntegerPart(b);
        if (intA == intB)
            return intA + Midpoint(a[intA.Length..], b[intB.Length..]);
        var next = IncrementInteger(intA) ?? throw new InvalidOperationException("Cannot increment any more.");
        return string.CompareOrdinal(next, b) < 0 ? next : intA + Midpoint(a[intA.Length..], null);
    }

    /// <summary>Generates <paramref name="n"/> ordered keys between <paramref name="a"/> and <paramref name="b"/> (npm <c>generateNKeysBetween</c>).</summary>
    public static IReadOnlyList<string> NKeysBetween(string? a, string? b, int n)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(n);
        if (n == 0)
            return [];
        if (n == 1)
            return [KeyBetween(a, b)];

        if (b is null)
        {
            var keys = new List<string>(n);
            var current = KeyBetween(a, null);
            keys.Add(current);
            for (var i = 0; i < n - 1; i++)
            {
                current = KeyBetween(current, null);
                keys.Add(current);
            }
            return keys;
        }

        if (a is null)
        {
            var keys = new List<string>(n);
            var current = KeyBetween(null, b);
            keys.Add(current);
            for (var i = 0; i < n - 1; i++)
            {
                current = KeyBetween(null, current);
                keys.Add(current);
            }
            keys.Reverse();
            return keys;
        }

        var mid = n / 2;
        var middle = KeyBetween(a, b);
        return [.. NKeysBetween(a, middle, mid), middle, .. NKeysBetween(middle, b, n - mid - 1)];
    }

    private static string Midpoint(string a, string? b)
    {
        if (b is not null && string.CompareOrdinal(a, b) >= 0)
            throw new ArgumentException($"{a} >= {b}");
        if (a.EndsWith(Zero) || (b is not null && b.EndsWith(Zero)))
            throw new ArgumentException("Trailing zero.");

        if (!string.IsNullOrEmpty(b))
        {
            var n = 0;
            while ((n < a.Length ? a[n] : Zero) == b[n])
                n++;
            if (n > 0)
                return b[..n] + Midpoint(n < a.Length ? a[n..] : string.Empty, b[n..]);
        }

        var digitA = a.Length > 0 ? Digits.IndexOf(a[0], StringComparison.Ordinal) : 0;
        var digitB = b is not null ? Digits.IndexOf(b[0], StringComparison.Ordinal) : Digits.Length;
        if (digitB - digitA > 1)
            return Digits[(int)Math.Round(0.5 * (digitA + digitB), MidpointRounding.AwayFromZero)].ToString();
        if (b is { Length: > 1 })
            return b[..1];
        return Digits[digitA] + Midpoint(a.Length > 0 ? a[1..] : string.Empty, null);
    }

    private static int IntegerLength(char head)
    {
        var i = IntDigits.IndexOf(head, StringComparison.Ordinal);
        if (i < 0)
            throw new ArgumentException($"Invalid order key head: {head}");
        const int half = 26;
        return i < half ? half - i + 1 : i - half + 2;
    }

    private static string IntegerPart(string key)
    {
        var length = IntegerLength(key[0]);
        if (length > key.Length)
            throw new ArgumentException($"Invalid order key: {key}");
        return key[..length];
    }

    private static void ValidateOrderKey(string key)
    {
        if (key == SmallestInteger)
            throw new ArgumentException($"Invalid order key: {key}");
        var i = IntegerPart(key);
        if (key.Length > i.Length && key[^1] == Zero)
            throw new ArgumentException($"Invalid order key: {key}");
    }

    private static string? IncrementInteger(string x) => Step(x, +1);

    private static string? DecrementInteger(string x) => Step(x, -1);

    private static string? Step(string x, int delta)
    {
        if (x.Length != IntegerLength(x[0]))
            throw new ArgumentException($"Invalid integer part: {x}");
        var wrap = delta > 0 ? Zero : Digits[^1];
        var trailing = string.Empty;
        for (var i = x.Length - 1; i >= 1; i--)
        {
            var d = Digits.IndexOf(x[i], StringComparison.Ordinal) + delta;
            if (d == Digits.Length || d == -1)
                trailing = wrap + trailing;
            else
                return x[0] + x[1..i] + Digits[d] + trailing;
        }

        var headIndex = IntDigits.IndexOf(x[0], StringComparison.Ordinal) + delta;
        if (headIndex < 0 || headIndex == IntDigits.Length)
            return null;
        var head = IntDigits[headIndex];
        var lengthDelta = IntegerLength(head) - IntegerLength(x[0]);
        return head + (lengthDelta > 0 ? trailing + wrap : lengthDelta < 0 ? trailing[1..] : trailing);
    }
}
