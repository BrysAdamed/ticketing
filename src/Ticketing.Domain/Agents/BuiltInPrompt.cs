namespace Ticketing.Domain.Agents;

/// <summary>A shipped default for one slot. <see cref="Version"/> is the built-in release, for example <c>2026.10.1</c>.</summary>
public sealed record BuiltInPrompt(AgentPromptSlot Slot, string Version, string Body)
{
    public const int VersionMaxLength = 20;

    /// <summary>True when this release is newer than <paramref name="version"/> (null counts as older than anything).</summary>
    public bool IsNewerThan(string? version) =>
        version is null || BuiltInVersions.Parse(Version).CompareTo(BuiltInVersions.Parse(version)) > 0;
}

public static class BuiltInVersions
{
    /// <summary>Built-in releases are dotted numbers (<c>2026.10.1</c>) compared numerically, part by part.</summary>
    public static Version Parse(string version) =>
        Version.TryParse(version, out var parsed) ? parsed : throw new FormatException($"'{version}' is not a built-in prompt version such as 2026.10.1.");
}
