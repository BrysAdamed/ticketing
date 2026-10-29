using System.Text.RegularExpressions;
using Ticketing.Domain.Users;

namespace Ticketing.Domain.Tests.Users;

public sealed partial class AvatarCatalogTests
{
    /// <summary>Shared with the Angular catalogue: web/src/app/shared/avatars/avatar-catalog.ts, which ships the art per key.</summary>
    private static readonly string WebCatalog = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "TestData", "avatar-catalog.ts"));

    [Fact]
    public void Web_catalogue_lists_the_same_icons_in_the_same_order()
    {
        // Act
        var web = IconEntry().Matches(WebCatalog).Select(m => (m.Groups["key"].Value, m.Groups["label"].Value, m.Groups["group"].Value));

        // Assert
        Assert.Equal(AvatarCatalog.Icons.Select(i => (i.Key, i.Label, i.Group)), web);
    }

    [Fact]
    public void Web_catalogue_lists_the_same_colours_in_palette_order()
    {
        // Act
        var web = ColorEntry().Matches(WebCatalog).Select(m => m.Groups["key"].Value);

        // Assert
        Assert.Equal(AvatarCatalog.Colors, web);
    }

    [GeneratedRegex(@"\{ key: '(?<key>[a-z]+)', label: '(?<label>[^']+)', group: '(?<group>[^']+)' \}")]
    private static partial Regex IconEntry();

    [GeneratedRegex(@"\{ key: '(?<key>[a-z]+)', label: '[^']+' \}")]
    private static partial Regex ColorEntry();
}
