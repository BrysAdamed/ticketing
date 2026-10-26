using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Users;

/// <summary>A one-time set-password link. The SPA turns <see cref="Path"/> into an absolute URL with its own origin.</summary>
public sealed record SetPasswordLinkDto(string Token, string Path, DateTimeOffset ExpiresAt);

/// <summary>One-time set-password tokens: 256 random bits, base64url; only the SHA-256 hex hash is stored (spec 4.1).</summary>
internal static class SetPasswordLinks
{
    public const string PagePath = "/set-password";

    public static SetPasswordLinkDto Issue(User user, TimeSpan lifetime, DateTimeOffset now)
    {
        var token = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));
        var expiresAt = now + lifetime;
        user.IssueSetPasswordToken(Hash(token), expiresAt);
        return new SetPasswordLinkDto(token, $"{PagePath}?token={token}", expiresAt);
    }

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token.Trim())));
}
