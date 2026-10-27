using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;
using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;

namespace Ticketing.Domain.Agents;

/// <summary>
/// A project's git remote (spec 13.3) in one of three forms: <c>https://[user@]host[:port]/path</c>,
/// <c>ssh://[user@]host[:port]/path</c> or scp-style <c>user@host:path</c>, each optionally ending in <c>.git</c>.
/// <see cref="Value"/> is what was typed (trimmed); <see cref="Key"/> is the form two remotes of one repository share:
/// host and path in lower case, without scheme, user, port, <c>.git</c> or slashes at either end
/// (<c>git.example.com/team/ticketing</c>). Only printable ASCII is accepted, and never a password or a user name that looks
/// like an access token (a known token prefix, a leading <c>-</c> or more than 50 characters), because readers and the agent see it.
/// </summary>
public sealed partial record GitRemoteUrl
{
    public const int MaxLength = 500;

    private GitRemoteUrl(string value, string key)
    {
        Value = value;
        Key = key;
    }

    public string Value { get; }

    public string Key { get; }

    /// <summary>Parses <paramref name="value"/> or throws a validation error for <paramref name="field"/>.</summary>
    public static GitRemoteUrl Parse(string value, string field) =>
        TryParse(value, out var url)
            ? url
            : throw DomainException.Invalid(
                field, ProjectErrors.RepositoryUrlInvalid, "The repository URL must be an https, ssh or scp-style git remote.",
                "For example https://git.example.com/team/repo.git or git@git.example.com:team/repo.git.");

    public static bool TryParse(string? value, [NotNullWhen(true)] out GitRemoteUrl? url)
    {
        url = null;
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed) || trimmed.Length > MaxLength)
            return false;

        var match = HttpsForm().Match(trimmed);
        if (!match.Success)
            match = SshForm().Match(trimmed);
        if (!match.Success)
            match = ScpForm().Match(trimmed);
        if (!match.Success || LooksLikeToken(match.Groups["user"].Value) || !TryNormalizePath(match.Groups["path"].Value, out var path))
            return false;

        url = new GitRemoteUrl(trimmed, $"{match.Groups["host"].Value}/{path}".ToLowerInvariant());
        return true;
    }

    private static bool LooksLikeToken(string user) =>
        TokenPrefixes.Any(prefix => user.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));

    private static bool TryNormalizePath(string path, [NotNullWhen(true)] out string? normalized)
    {
        normalized = null;
        var trimmed = path.Trim('/');
        if (trimmed.EndsWith(".git", StringComparison.OrdinalIgnoreCase))
            trimmed = trimmed[..^4].TrimEnd('/');
        var segments = trimmed.Split('/');
        if (segments.Any(s => s.Length == 0 || s is "." or ".."))
            return false;
        normalized = trimmed;
        return true;
    }

    private static readonly string[] TokenPrefixes =
        ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "glpat-", "gldt-", "glptt-", "glrt-", "gloas-", "ATBB", "ATCTT", "xoxb-", "xoxp-", "tkt_"];

    private const string User = "(?:(?<user>[A-Za-z0-9._~+][A-Za-z0-9._~%+-]{0,49})@)";
    private const string Host = "(?<host>[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)";
    private const string Port = "(?::[0-9]{1,5})?";
    private const string Path = "(?<path>[A-Za-z0-9._~%+/-]+)";

    [GeneratedRegex($"^https://{User}?{Host}{Port}/{Path}\\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HttpsForm();

    [GeneratedRegex($"^ssh://{User}?{Host}{Port}/{Path}\\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SshForm();

    [GeneratedRegex($"^{User}{Host}:{Path}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex ScpForm();
}
