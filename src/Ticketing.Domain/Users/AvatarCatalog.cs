namespace Ticketing.Domain.Users;

/// <summary>A predefined avatar icon. <see cref="UnlockRequirement"/> is reserved for bonus avatars unlocked by achievements; null means everyone may pick it.</summary>
public sealed record AvatarIconEntry(string Key, string Label, string Group, string? UnlockRequirement = null);

/// <summary>
/// The avatars a user can pick instead of initials (spec 4.1, D-129): animal icons and named colours of the design-token
/// palette (<c>--tk-palette-0..7</c>, in that order). Defined in code, not in the database, so it can evolve without a migration;
/// stored keys that leave the catalogue fall back to initials.
/// </summary>
public static class AvatarCatalog
{
    public const int KeyMaxLength = 32;

    public static IReadOnlyList<AvatarIconEntry> Icons { get; } =
    [
        new("cat", "Cat", "Pets"),
        new("dog", "Dog", "Pets"),
        new("fish", "Fish", "Pets"),
        new("paw", "Paw", "Pets"),
        new("horse", "Horse", "Farm"),
        new("pig", "Pig", "Farm"),
        new("deer", "Deer", "Wild"),
        new("bat", "Bat", "Wild"),
        new("butterfly", "Butterfly", "Bugs"),
        new("bug", "Ladybug", "Bugs"),
        new("spider", "Spider", "Bugs"),
    ];

    public static IReadOnlyList<string> Colors { get; } = ["blue", "violet", "pink", "orange", "amber", "green", "teal", "cyan"];

    public static bool IsIcon(string? key) => key is not null && Icons.Any(i => i.Key == key);

    public static bool IsColor(string? key) => key is not null && Colors.Contains(key);
}
