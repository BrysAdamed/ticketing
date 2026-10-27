using Ticketing.Domain.Common;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;

namespace Ticketing.Domain.Tests.Users;

public sealed class UserLifecycleTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 26, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Setting_a_password_consumes_the_link_and_rotates_the_stamp()
    {
        // Arrange
        var user = User.Create("jane@example.com", "Jane", GlobalRole.User, null, Now);
        var stamp = user.SecurityStamp;
        user.IssueSetPasswordToken(new string('a', 64), Now.AddHours(1));

        // Act
        user.SetPasswordHash("hash");

        // Assert
        Assert.True(user.HasPassword);
        Assert.Null(user.SetPasswordTokenHash);
        Assert.NotEqual(stamp, user.SecurityStamp);
        Assert.Equal(User.SecurityStampLength, user.SecurityStamp.Length);
    }

    [Fact]
    public void Upgrading_a_hash_keeps_sessions()
    {
        // Arrange
        var user = User.Create("jane@example.com", "Jane", GlobalRole.User, null, Now);
        user.SetPasswordHash("v2-hash");
        var stamp = user.SecurityStamp;

        // Act
        user.UpgradePasswordHash("v3-hash");

        // Assert
        Assert.Equal(stamp, user.SecurityStamp);
    }

    [Fact]
    public void A_link_is_redeemable_only_while_valid_and_the_user_is_active()
    {
        // Arrange
        var actor = Guid.CreateVersion7();
        var user = User.Create("jane@example.com", "Jane", GlobalRole.User, null, Now);
        user.IssueSetPasswordToken(new string('a', 64), Now.AddHours(1));

        // Act
        var valid = user.CanRedeemSetPasswordToken(Now);
        var expired = user.CanRedeemSetPasswordToken(Now.AddHours(2));
        user.Deactivate(actor, Now);

        // Assert
        Assert.True(valid);
        Assert.False(expired);
        Assert.False(user.CanRedeemSetPasswordToken(Now));
        Assert.Null(user.SetPasswordTokenHash);
        Assert.Equal(UserErrors.Inactive, Assert.Throws<DomainException>(() => user.IssueSetPasswordToken("x", Now.AddHours(1))).Code);
    }

    [Theory]
    [InlineData(null, 10, PatStatus.Active)]
    [InlineData(null, -1, PatStatus.Expired)]
    [InlineData(-5, 10, PatStatus.Revoked)]
    [InlineData(-5, -1, PatStatus.Revoked)]
    public void Token_status_is_revoked_then_expired_then_active(int? revokedDaysAgo, int expiresInDays, PatStatus expected) =>
        Assert.Equal(expected, PersonalAccessToken.StatusOf(revokedDaysAgo is { } d ? Now.AddDays(d) : null, Now.AddDays(expiresInDays), Now));
}
