using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Auth;

/// <summary>Verifies email and password with lockout (spec 6.14). Signing in (the cookie) is the transport's job.</summary>
public static class Login
{
    public sealed record Command(string Email, string Password) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Required("email", Email, User.EmailMaxLength)
            .Required("password", Password, 1024);
    }

    public sealed class Handler(ITicketingDbContext db, IPasswordHasher hasher, IClock clock) : IHandler<Command, CurrentUserDto>
    {
        private static readonly User TimingDummy = User.Create("timing@invalid.local", "Timing", GlobalRole.User, null, DateTimeOffset.UnixEpoch);
        private static string? _timingDummyHash;

        public async Task<CurrentUserDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var email = command.Email.Trim().ToLowerInvariant();
            var user = await db.Users.SingleOrDefaultAsync(u => u.Email == email, cancellationToken);

            if (user is null || !user.IsActive || user.PasswordHash is null)
            {
                hasher.Verify(TimingDummy, _timingDummyHash ??= hasher.Hash(TimingDummy, "timing-dummy-password"), command.Password);
                throw InvalidCredentials();
            }

            var now = clock.Now;
            if (user.IsLockedOut(now))
                throw LockedOut();

            var check = hasher.Verify(user, user.PasswordHash, command.Password);
            if (check == PasswordCheck.Failed)
            {
                var lockedNow = user.RegisterFailedLogin(now);
                await db.SaveChangesAsync(cancellationToken);
                throw lockedNow ? LockedOut() : InvalidCredentials();
            }

            if (check == PasswordCheck.SuccessRehashNeeded)
                user.SetPasswordHash(hasher.Hash(user, command.Password));
            user.RegisterSuccessfulLogin(now);
            await db.SaveChangesAsync(cancellationToken);
            return new CurrentUserDto(user.Id, user.Email, user.DisplayName, user.GlobalRole);
        }

        private static AppException InvalidCredentials() =>
            AppException.Unauthenticated(AppErrors.InvalidCredentials, "The email or password is incorrect.");

        private static AppException LockedOut() =>
            AppException.Locked(AppErrors.LockedOut, "Too many failed sign-in attempts. Try again in 15 minutes.");
    }
}
