using System.Text.RegularExpressions;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Tickets;

/// <summary>Label rules (spec 4.5): lower case, <c>^[a-z0-9][a-z0-9._-]{0,49}$</c>, de-duplicated, sorted, at most 20.</summary>
public static partial class TicketLabels
{
    public const int MaxCount = 20;

    public static List<string> Normalize(IEnumerable<string?>? labels)
    {
        var result = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var raw in labels ?? [])
        {
            var label = raw?.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(label))
                continue;
            if (!LabelPattern().IsMatch(label))
                throw DomainException.Invalid(
                    "labels", TicketErrors.LabelsInvalid, $"Label '{raw}' is invalid.",
                    "Labels use letters, digits, '.', '_' or '-', start with a letter or digit and are at most 50 characters.");
            result.Add(label);
        }

        if (result.Count > MaxCount)
            throw DomainException.Invalid("labels", TicketErrors.LabelsTooMany, $"A ticket can have at most {MaxCount} labels.");
        return [.. result];
    }

    /// <summary>Adds and removes labels (case-insensitively) on top of <paramref name="current"/>; the result is normalized.</summary>
    public static List<string> Edit(IEnumerable<string> current, IEnumerable<string?>? add, IEnumerable<string?>? remove)
    {
        var removed = (remove ?? []).Select(r => r?.Trim().ToLowerInvariant()).OfType<string>().ToHashSet(StringComparer.Ordinal);
        var added = Normalize(add);
        return Normalize(current.Concat(added).Where(l => !removed.Contains(l)));
    }

    [GeneratedRegex("^[a-z0-9][a-z0-9._-]{0,49}$", RegexOptions.CultureInvariant)]
    private static partial Regex LabelPattern();
}
