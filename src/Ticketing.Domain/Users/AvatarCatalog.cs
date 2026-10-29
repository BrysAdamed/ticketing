namespace Ticketing.Domain.Users;

/// <summary>A predefined avatar icon. <see cref="UnlockRequirement"/> is reserved for bonus avatars unlocked by achievements; null means everyone may pick it.</summary>
public sealed record AvatarIconEntry(string Key, string Label, string Group, string? UnlockRequirement = null);

/// <summary>
/// The avatars a user can pick instead of initials (spec 4.1, D-129): animal icons and named colours of the design-token
/// palette (<c>--tk-palette-0..7</c>, in that order). Defined in code, not in the database, so it can evolve without a migration;
/// stored keys that leave the catalogue fall back to initials. The web app mirrors the icons in
/// <c>web/src/app/shared/avatars/avatar-catalog.ts</c> with one Fluent Emoji (Flat) image per key (D-130).
/// </summary>
public static class AvatarCatalog
{
    public const int KeyMaxLength = 32;

    public static IReadOnlyList<AvatarIconEntry> Icons { get; } =
    [
        new("dog", "Dog", "Pets"),
        new("cat", "Cat", "Pets"),
        new("mouse", "Mouse", "Pets"),
        new("hamster", "Hamster", "Pets"),
        new("rabbit", "Rabbit", "Pets"),
        new("fish", "Fish", "Pets"),
        new("pig", "Pig", "Farm"),
        new("cow", "Cow", "Farm"),
        new("horse", "Horse", "Farm"),
        new("chick", "Chick", "Farm"),
        new("fox", "Fox", "Wild"),
        new("bear", "Bear", "Wild"),
        new("panda", "Panda", "Wild"),
        new("koala", "Koala", "Wild"),
        new("tiger", "Tiger", "Wild"),
        new("lion", "Lion", "Wild"),
        new("monkey", "Monkey", "Wild"),
        new("wolf", "Wolf", "Wild"),
        new("raccoon", "Raccoon", "Wild"),
        new("hedgehog", "Hedgehog", "Wild"),
        new("otter", "Otter", "Wild"),
        new("sloth", "Sloth", "Wild"),
        new("frog", "Frog", "Wild"),
        new("unicorn", "Unicorn", "Wild"),
        new("owl", "Owl", "Birds"),
        new("penguin", "Penguin", "Birds"),
        new("octopus", "Octopus", "Sea"),
        new("turtle", "Turtle", "Sea"),
        new("whale", "Whale", "Sea"),
        new("bee", "Bee", "Bugs"),
        new("butterfly", "Butterfly", "Bugs"),
        new("bug", "Ladybug", "Bugs"),
    ];

    public static IReadOnlyList<string> Colors { get; } = ["blue", "violet", "pink", "orange", "amber", "green", "teal", "cyan"];

    public static bool IsIcon(string? key) => key is not null && Icons.Any(i => i.Key == key);

    public static bool IsColor(string? key) => key is not null && Colors.Contains(key);
}
