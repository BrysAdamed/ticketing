using System.Text.RegularExpressions;
using Ticketing.Application.FeatureFlags;
using Ticketing.Domain.FeatureFlags;

namespace Ticketing.IntegrationTests.FeatureFlags;

public sealed partial class FeatureFlagCatalogTests
{
    [Fact]
    public void Every_flag_key_the_spa_reads_is_declared_in_the_catalog()
    {
        // Arrange
        var source = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "TestData", "flag-keys.ts"));

        // Act
        var spaKeys = SpaFlagKey().Matches(source).Select(m => m.Groups["key"].Value).ToList();

        // Assert
        Assert.NotEmpty(spaKeys);
        Assert.Empty(spaKeys.Except(FeatureFlagCatalog.All.Select(d => d.Key)));
    }

    [Fact]
    public void Every_declared_flag_has_a_valid_unique_key_and_a_description()
    {
        // Act
        var keys = FeatureFlagCatalog.All.Select(d => d.Key).ToList();

        // Assert
        Assert.All(FeatureFlagCatalog.All, d =>
        {
            Assert.True(FeatureFlag.IsValidKey(d.Key), $"'{d.Key}' is not a valid flag key.");
            Assert.False(string.IsNullOrWhiteSpace(d.Description), $"'{d.Key}' has no description.");
            Assert.True(d.Description.Length <= FeatureFlag.DescriptionMaxLength, $"The description of '{d.Key}' is too long.");
        });
        Assert.Equal(keys.Count, keys.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Todays_flags_have_the_owner_confirmed_defaults()
    {
        // Assert
        Assert.False(FeatureFlagCatalog.AgentDelegate.DefaultOn);
        Assert.True(FeatureFlagCatalog.SubticketsGraph.DefaultOn);
        Assert.True(FeatureFlagCatalog.Achievements.DefaultOn);
    }

    [GeneratedRegex(@"^export const \w+ = '(?<key>[^']+)';", RegexOptions.Multiline)]
    private static partial Regex SpaFlagKey();
}
