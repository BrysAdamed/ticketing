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
    public void Valid_keys_are_accepted(string key) => Assert.Equal(key, FeatureFlag.Create(key, null, null, Now).Key);

    [Theory]
    [InlineData("Board")]
    [InlineData("1flag")]
    [InlineData("board..x")]
    [InlineData("board.")]
    [InlineData("")]
    public void Invalid_keys_are_rejected(string key) =>
        Assert.Equal("flag.key.invalid", Assert.Throws<DomainException>(() => FeatureFlag.Create(key, null, null, Now)).Code);

    [Theory]
    [InlineData(-1)]
    [InlineData(101)]
    public void Rollout_must_be_a_percentage(int rollout) =>
        Assert.Throws<DomainException>(() => Flag(true, rollout, [], []));

    private static FeatureFlag Flag(bool enabled, int rollout, Guid[] users, GlobalRole[] roles, string key = "test.flag")
    {
        var flag = FeatureFlag.Create(key, null, null, Now);
        flag.Configure(null, enabled, rollout, users, roles, null, Now);
        return flag;
    }

    private sealed record Vector(string FlagKey, string UserId, int Bucket);
}
