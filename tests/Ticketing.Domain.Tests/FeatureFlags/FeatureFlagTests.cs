using System.Text.Json;
using Ticketing.Domain.Common;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Users;

namespace Ticketing.Domain.Tests.FeatureFlags;

public sealed class FeatureFlagTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 26, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Shared with the Angular implementation: docs/architecture/flag-bucketing-vectors.json.</summary>
    public static TheoryData<string, string, int> SharedVectors()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "TestData", "flag-bucketing-vectors.json");
        var vectors = JsonSerializer.Deserialize<List<Vector>>(File.ReadAllText(path), JsonSerializerOptions.Web)!;
        var data = new TheoryData<string, string, int>();
        foreach (var v in vectors)
            data.Add(v.FlagKey, v.UserId, v.Bucket);
        return data;
    }

    [Theory]
    [MemberData(nameof(SharedVectors))]
    public void Bucket_matches_the_shared_vectors(string flagKey, string userId, int expected) =>
        Assert.Equal(expected, FlagBucket.Compute(flagKey, Guid.Parse(userId)));

    [Fact]
    public void Bucket_uses_the_lower_case_guid_format()
    {
        // Arrange
        var id = Guid.Parse("ABCDEF01-2345-6789-ABCD-EF0123456789");

        // Act
        var bucket = FlagBucket.Compute("board.swimlanes", id);

        // Assert
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("board.swimlanes:abcdef01-2345-6789-abcd-ef0123456789"));
        Assert.Equal((int)(System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(hash) % 100), bucket);
    }

    [Fact]
    public void Disabled_flag_is_off_even_for_targeted_users()
    {
        // Arrange
        var user = Guid.NewGuid();
        var flag = Flag(enabled: false, rollout: 100, users: [user], roles: [GlobalRole.User]);

        // Act / Assert
        Assert.Equal(FlagVariants.Off, flag.Evaluate(user, GlobalRole.User));
    }

    [Fact]
    public void Targeted_user_and_role_are_on_regardless_of_rollout()
    {
        // Arrange
        var user = Guid.NewGuid();
        var flag = Flag(enabled: true, rollout: 0, users: [user], roles: [GlobalRole.Admin]);

        // Act / Assert
        Assert.Equal(FlagVariants.On, flag.Evaluate(user, GlobalRole.User));
        Assert.Equal(FlagVariants.On, flag.Evaluate(Guid.NewGuid(), GlobalRole.Admin));
        Assert.Equal(FlagVariants.Off, flag.Evaluate(Guid.NewGuid(), GlobalRole.User));
    }

    [Fact]
    public void Rollout_compares_the_bucket_with_the_percentage()
    {
        // Arrange
        var user = Guid.Parse("0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f");
        var bucket = FlagBucket.Compute("board.swimlanes", user);

        // Act / Assert
        Assert.Equal(FlagVariants.Off, Flag(true, bucket, [], [], "board.swimlanes").Evaluate(user, GlobalRole.User));
        Assert.Equal(FlagVariants.On, Flag(true, bucket + 1, [], [], "board.swimlanes").Evaluate(user, GlobalRole.User));
    }

    [Theory]
    [InlineData("board.swimlanes")]
    [InlineData("ticket-view.v2")]
    [InlineData("a")]
    public void Valid_keys_are_accepted(string key) => Assert.Equal(key, FeatureFlag.Register(key, null, false, Now).Key);

    [Theory]
    [InlineData("Board")]
    [InlineData("1flag")]
    [InlineData("board..x")]
    [InlineData("board.")]
    [InlineData("")]
    public void Invalid_keys_are_rejected(string key) =>
        Assert.Equal("flag.key.invalid", Assert.Throws<DomainException>(() => FeatureFlag.Register(key, null, false, Now)).Code);

    [Theory]
    [InlineData(-1)]
    [InlineData(101)]
    public void Rollout_must_be_a_percentage(int rollout) =>
        Assert.Throws<DomainException>(() => Flag(true, rollout, [], []));

    [Theory]
    [InlineData(true, 100, "on")]
    [InlineData(false, 0, "off")]
    public void A_registered_flag_starts_from_its_default_for_everyone(bool defaultOn, int rollout, string variant)
    {
        // Act
        var flag = FeatureFlag.Register("test.flag", "Declared in code", defaultOn, Now);

        // Assert
        Assert.Equal((defaultOn, rollout, (Guid?)null), (flag.Enabled, flag.RolloutPercentage, flag.UpdatedById));
        Assert.True(flag.HasDefaultConfiguration(defaultOn));
        Assert.False(flag.HasDefaultConfiguration(!defaultOn));
        Assert.Equal(variant, flag.Evaluate(Guid.NewGuid(), GlobalRole.User));
    }

    [Fact]
    public void Targeting_makes_a_flag_differ_from_its_default_and_reset_restores_it()
    {
        // Arrange
        var actor = Guid.NewGuid();
        var flag = FeatureFlag.Register("test.flag", null, defaultOn: true, Now);
        flag.Configure(true, 100, [], [GlobalRole.Admin], actor, Now);
        var changed = flag.HasDefaultConfiguration(true);

        // Act
        flag.ResetToDefault(true, actor, Now.AddHours(1));

        // Assert
        Assert.False(changed);
        Assert.True(flag.HasDefaultConfiguration(true));
        Assert.Empty(flag.TargetRoles);
        Assert.Equal((actor, Now.AddHours(1)), (flag.UpdatedById!.Value, flag.UpdatedAt));
    }

    [Fact]
    public void Describing_a_flag_from_code_does_not_count_as_a_change()
    {
        // Arrange
        var flag = FeatureFlag.Register("test.flag", "Old", defaultOn: false, Now);

        // Act
        var first = flag.Describe("New");
        var second = flag.Describe("New");

        // Assert
        Assert.Equal((true, false, "New", Now), (first, second, flag.Description, flag.UpdatedAt));
    }

    private static FeatureFlag Flag(bool enabled, int rollout, Guid[] users, GlobalRole[] roles, string key = "test.flag")
    {
        var flag = FeatureFlag.Register(key, null, false, Now);
        flag.Configure(enabled, rollout, users, roles, null, Now);
        return flag;
    }

    private sealed record Vector(string FlagKey, string UserId, int Bucket);
}
