using System.Globalization;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Agents;

/// <summary>
/// Composes the final prompt: the rendered type template, then a blank line and the rendered guardrails when they are
/// non-empty. The result must stay below <see cref="LengthLimit"/> characters so it fits Claude's 5 000-character deep link
/// with room for URL encoding of the folder (D-98).
/// </summary>
public static class AgentPrompt
{
    public const int LengthLimit = 4_500;

    public static string Compose(string typeTemplate, string? guardrails)
    {
        var body = typeTemplate.Trim();
        var rules = guardrails?.Trim();
        return string.IsNullOrEmpty(rules) ? body : $"{body}\n\n{rules}";
    }

    public static bool FitsLimit(string prompt) => prompt.Length < LengthLimit;

    public static string TooLongMessage(int length) =>
        string.Create(CultureInfo.InvariantCulture, $"The prompt is {length} characters with the guardrails; it must stay below {LengthLimit} to fit Claude's deep link.");

    public static void EnsureFitsLimit(string prompt, string field)
    {
        if (!FitsLimit(prompt))
            throw DomainException.Invalid(field, AgentErrors.PromptTooLong, TooLongMessage(prompt.Length), "Shorten the template or the guardrails.");
    }
}
