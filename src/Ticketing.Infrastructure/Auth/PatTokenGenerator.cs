using System.Security.Cryptography;
using System.Text;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Tokens;

namespace Ticketing.Infrastructure.Auth;

internal sealed class PatTokenGenerator : IPatTokenGenerator
{
    private const string Base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    public GeneratedPat Generate()
    {
        var secret = RandomNumberGenerator.GetString(Base62, PersonalAccessToken.SecretLength);
        var token = PersonalAccessToken.TokenPrefix + secret;
        return new GeneratedPat(token, token[..PersonalAccessToken.DisplayPrefixLength], Hash(token));
    }

    public string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
