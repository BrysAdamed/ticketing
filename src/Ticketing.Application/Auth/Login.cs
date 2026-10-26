using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Auth;

/// <summary>
/// Verifies email and password with lockout (spec 6.14). Attempts for one account are serialised by a row lock
/// (<c>SELECT … FOR UPDATE</c>), so parallel wrong guesses each count and a correct login during an attack never
/// conflicts. Signing in (the cookie) is the transport's job.
/// </summary>
public static class Login
{
    public sealed record Command(string Email, string Password) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Required("email", Email, User.EmailMaxLength)
            .Required("password", Password, 1024);
    }

    public sealed class Handler(ITicketingDbContext db, IPasswordHasher hasher, IClock clock) : IHandler<Command, SessionIdentity>
    {
        private static readonly User TimingDummy = User.Create("timing@invalid.local", "Timing", GlobalRole.User, null, DateTimeOffset.UnixEpoch);
        private static string? _timingDummyHash;

        public async Task<SessionIdentity> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var email = command.Email.Trim().ToLowerInvariant();
            var (outcome, user) = await db.InTransactionAsync(ct => AttemptAsync(email, command.Password, ct), cancellationToken);
            return outcome switch
            {
                Outcome.Success => SessionIdentity.For(user!),
                Outcome.LockedOut => throw AppException.Locked(AppErrors.LockedOut, "Too many failed sign-in attempts. Try again in 15 minutes."),
                _ => throw AppException.Unauthenticated(AppErrors.InvalidCredentials, "The email or password is incorrect."),
            };
        }

        private async Task<(Outcome, User?)> AttemptAsync(string email, string password, CancellationToken cancellationToken)
        {
            var user = (await db.Users.FromSql($"SELECT *, xmin FROM users WHERE email = {email} FOR UPDATE").ToListAsync(cancellationToken)).SingleOrDefault();
            if (user is null || !user.IsActive || user.PasswordHash is null)
            {
                hasher.Verify(TimingDummy, _timingDummyHash ??= hasher.Hash(TimingDummy, "timing-dummy-password"), password);
                return (Outcome.InvalidCredentials, null);
            }

            var now = clock.Now;
            if (user.IsLockedOut(now))
                return (Outcome.LockedOut, null);

            var check = hasher.Verify(user, user.PasswordHash, password);
            if (check == PasswordCheck.Failed)
            {
                var lockedNow = user.RegisterFailedLogin(now);
                await db.SaveChangesAsync(cancellationToken);
                return (lockedNow ? Outcome.LockedOut : Outcome.InvalidCredentials, null);
            }

            if (check == PasswordCheck.SuccessRehashNeeded)
                user.UpgradePasswordHash(hasher.Hash(user, password));
            user.RegisterSuccessfulLogin(now);
            await db.SaveChangesAsync(cancellationToken);
            return (Outcome.Success, user);
        }

        private enum Outcome
        {
            Success,
            InvalidCredentials,
            LockedOut,
        }
    }
}
