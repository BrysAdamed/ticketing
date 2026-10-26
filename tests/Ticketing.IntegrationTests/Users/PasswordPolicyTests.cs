using Ticketing.Application.Users;
using Ticketing.Domain.Common;
using Ticketing.Domain.Users;

namespace Ticketing.IntegrationTests.Users;

public sealed class PasswordPolicyTests
{
    [Theory]
    [InlineData("eleven-char")]
    [InlineData("")]
    public void Shorter_than_12_is_rejected(string password) =>
        Assert.Equal(UserErrors.PasswordTooShort, Assert.Throws<DomainException>(() => PasswordPolicy.Validate(password, "a@b.test")).Code);

    [Theory]
    [InlineData("qwerty123456")]
    [InlineData("QwErTy123456")]
    [InlineData("1qaz2wsx3edc")]
    public void Common_passwords_are_rejected_case_insensitively(string password) =>
        Assert.Equal(UserErrors.PasswordTooCommon, Assert.Throws<DomainException>(() => PasswordPolicy.Validate(password, "a@b.test")).Code);

    [Fact]
    public void The_bundled_list_has_ten_thousand_passwords_long_enough_to_matter()
    {
        // Arrange
        using var stream = typeof(PasswordPolicy).Assembly.GetManifestResourceStream("Ticketing.Application.Users.common-passwords.txt")!;
        using var reader = new StreamReader(stream);

        // Act
        var lines = reader.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries);

        // Assert
        Assert.Equal(10_000, lines.Length);
        Assert.All(lines, l => Assert.InRange(l.Length, PasswordPolicy.MinLength, PasswordPolicy.MaxLength));
    }

    [Fact]
    public void Exactly_12_and_128_characters_with_no_composition_rules_are_accepted()
    {
        // Act
        var exception = Record.Exception(() =>
        {
            PasswordPolicy.Validate("violetladder", "a@b.test");
            PasswordPolicy.Validate(new string('z', 128), "a@b.test");
        });

        // Assert
        Assert.Null(exception);
    }
}
