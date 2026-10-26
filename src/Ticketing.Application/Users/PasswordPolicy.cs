using System.Collections.Frozen;
using Ticketing.Domain.Common;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Users;

/// <summary>
/// Password rules (spec 6.14, NIST 800-63B): 12..128 characters, not the email address, not one of the 10 000 most
/// common passwords that are long enough to pass the length rule (SecLists, embedded resource). No composition rules.
/// </summary>
public static class PasswordPolicy
{
    public const int MinLength = 12;
    public const int MaxLength = 128;
    private const string ResourceName = "Ticketing.Application.Users.common-passwords.txt";

    private static readonly Lazy<FrozenSet<string>> CommonPasswords = new(LoadCommonPasswords);

    public static void Validate(string? password, string email, string field = "password")
    {
        if (string.IsNullOrEmpty(password) || password.Length < MinLength)
            throw DomainException.Invalid(field, UserErrors.PasswordTooShort, $"The password must be at least {MinLength} characters.",
                "A passphrase of a few unrelated words is long and easy to remember.");
        if (password.Length > MaxLength)
            throw DomainException.Invalid(field, UserErrors.PasswordTooLong, $"The password must be at most {MaxLength} characters.");
        if (string.Equals(password.Trim(), email, StringComparison.OrdinalIgnoreCase))
            throw DomainException.Invalid(field, UserErrors.PasswordEqualsEmail, "The password must not be your email address.");
        if (IsCommon(password))
            throw DomainException.Invalid(field, UserErrors.PasswordTooCommon, "This password is too common. Choose another one.");
    }

    public static bool IsCommon(string password) => CommonPasswords.Value.Contains(password.ToLowerInvariant());

    private static FrozenSet<string> LoadCommonPasswords()
    {
        using var stream = typeof(PasswordPolicy).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded resource {ResourceName} is missing.");
        using var reader = new StreamReader(stream);
        var passwords = new List<string>();
        while (reader.ReadLine() is { } line)
        {
            if (line.Length >= MinLength)
                passwords.Add(line.ToLowerInvariant());
        }
        return passwords.ToFrozenSet(StringComparer.Ordinal);
    }
}
