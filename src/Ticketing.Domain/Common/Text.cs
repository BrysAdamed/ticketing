namespace Ticketing.Domain.Common;

/// <summary>Input text rules from spec section 2: trim, empty equals null, lengths in UTF-16 code units.</summary>
public static class Text
{
    public static string? Optional(string? value, string field, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
            return null;
        EnsureMaxLength(trimmed, field, maxLength);
        return trimmed;
    }

    public static string Required(string? value, string field, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
            throw DomainException.Invalid(field, "validation.required", $"{field} is required.");
        EnsureMaxLength(trimmed, field, maxLength);
        return trimmed;
    }

    public static string SingleLine(string? value, string field, int maxLength)
    {
        var text = Required(value, field, maxLength);
        if (text.Contains('\n', StringComparison.Ordinal) || text.Contains('\r', StringComparison.Ordinal))
            throw DomainException.Invalid(field, "validation.singleLine", $"{field} must be a single line.");
        return text;
    }

    private static void EnsureMaxLength(string value, string field, int maxLength)
    {
        if (value.Length > maxLength)
            throw DomainException.Invalid(field, "validation.tooLong", $"{field} must be at most {maxLength} characters.");
    }
}
