using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;

namespace Ticketing.Domain.Agents;

/// <summary>
/// A branch name that <c>git check-ref-format --branch</c> accepts, limited to ASCII letters, digits, <c>-</c>, <c>_</c>,
/// <c>.</c> and <c>/</c> and <see cref="MaxLength"/> characters because it is rendered into agent prompts (no shell or markup characters).
/// </summary>
public static class GitBranchName
{
    public const int MaxLength = 100;
    public const string Default = "main";

    /// <summary>Returns the trimmed name or throws a validation error for <paramref name="field"/>.</summary>
    public static string Normalize(string? value, string field)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        if (!IsValid(trimmed))
            throw DomainException.Invalid(
                field, ProjectErrors.DefaultBranchInvalid, "The default branch is not a valid git branch name.",
                "Use a name such as main or develop: ASCII letters, digits, '-', '_', '.' and '/', at most 100 characters.");
        return trimmed;
    }

    public static bool IsValid(string? name) =>
        !string.IsNullOrEmpty(name)
        && name.Length <= MaxLength
        && name.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or '/')
        && !name.StartsWith('-')
        && !name.StartsWith('/')
        && !name.EndsWith('/')
        && !name.EndsWith('.')
        && !name.Contains("..", StringComparison.Ordinal)
        && !name.Contains("//", StringComparison.Ordinal)
        && name.Split('/').All(c => !c.StartsWith('.') && !c.EndsWith(".lock", StringComparison.Ordinal));
}
