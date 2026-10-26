using Microsoft.AspNetCore.Identity;
using Ticketing.Domain.Users;
using IPasswordHasher = Ticketing.Application.Abstractions.IPasswordHasher;
using PasswordCheck = Ticketing.Application.Abstractions.PasswordCheck;

namespace Ticketing.Infrastructure.Auth;

internal sealed class PasswordHasherAdapter : IPasswordHasher
{
    private readonly PasswordHasher<User> _hasher = new();

    public string Hash(User user, string password) => _hasher.HashPassword(user, password);

    public PasswordCheck Verify(User user, string passwordHash, string password) =>
        _hasher.VerifyHashedPassword(user, passwordHash, password) switch
        {
            PasswordVerificationResult.Success => PasswordCheck.Success,
            PasswordVerificationResult.SuccessRehashNeeded => PasswordCheck.SuccessRehashNeeded,
            _ => PasswordCheck.Failed,
        };
}
