using System.Text.RegularExpressions;

namespace Ticketing.Application.Common;

/// <summary>
/// Implemented by commands that validate their input shape. Handlers call <see cref="ValidationExtensions.EnsureValid{T}"/>
/// first, so every field error is reported at once (400 <c>validation</c>). Domain invariants are still enforced by the entities.
/// </summary>
public interface IValidatable
{
    void Validate(Validator validator);
}

/// <summary>Collects per-field validation errors. Field names are the camelCase names clients send.</summary>
public sealed class Validator
{
    private readonly Dictionary<string, List<string>> _errors = new(StringComparer.Ordinal);

    public bool IsValid => _errors.Count == 0;

    public Validator Required(string field, string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
            return Add(field, $"{field} is required.");
        return MaxLength(field, value, maxLength);
    }

    public Validator MaxLength(string field, string? value, int maxLength) =>
        value is not null && value.Trim().Length > maxLength ? Add(field, $"{field} must be at most {maxLength} characters.") : this;

    public Validator Matches(string field, string? value, Regex pattern, string message) =>
        value is not null && !pattern.IsMatch(value.Trim()) ? Add(field, message) : this;

    public Validator Range(string field, int? value, int min, int max) =>
        value is { } v && (v < min || v > max) ? Add(field, $"{field} must be between {min} and {max}.") : this;

    public Validator Must(bool condition, string field, string message) => condition ? this : Add(field, message);

    public Validator Add(string field, string message)
    {
        if (!_errors.TryGetValue(field, out var messages))
            _errors[field] = messages = [];
        messages.Add(message);
        return this;
    }

    public void ThrowIfInvalid()
    {
        if (!IsValid)
            throw AppException.Validation(_errors.ToDictionary(e => e.Key, e => e.Value.ToArray(), StringComparer.Ordinal));
    }
}

public static class ValidationExtensions
{
    public static T EnsureValid<T>(this T request)
        where T : IValidatable
    {
        var validator = new Validator();
        request.Validate(validator);
        validator.ThrowIfInvalid();
        return request;
    }
}
