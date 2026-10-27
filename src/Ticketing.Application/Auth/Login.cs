using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Auth;

/// <summary>
/// Verifies email and password with a lockout per account and client address (spec 6.14, D-74). Every failure, including
/// a locked pair or an unknown email, is the same 401 <c>auth.invalidCredentials</c> after the same password hash work,
/// so responses reveal neither which accounts exist nor which are locked. Attempts for one account are serialised by a
/// row lock (<c>SELECT … FOR UPDATE</c>), so parallel wrong guesses each count and a correct login during an attack never
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

    public sealed class Handler(ITicketingDbContext db, IPasswordHasher hasher, IClock clock, IClientAddress client) : IHandler<Command, SessionIdentity>
    {
        private static readonly User TimingDummy = User.Create("timing@invalid.local", "Timing", GlobalRole.User, null, DateTimeOffset.UnixEpoch);
        private static string? _timingDummyHash;

        public async Task<SessionIdentity> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var email = command.Email.Trim().ToLowerInvariant();
            var user = await db.InTransactionAsync(ct => AttemptAsync(email, command.Password, ct), cancellationToken);
            return user is not null
                ? SessionIdentity.For(user)
                : throw AppException.Unauthenticated(AppErrors.InvalidCredentials, "The email or password is incorrect.");
        }

        private async Task<User?> AttemptAsync(string email, string password, CancellationToken cancellationToken)
        {
            var user = (await db.Users.FromSql($"SELECT *, xmin FROM users WHERE email = {email} FOR UPDATE").ToListAsync(cancellationToken)).SingleOrDefault();
            if (user is null || !user.IsActive || user.PasswordHash is null)
            {
                hasher.Verify(TimingDummy, _timingDummyHash ??= hasher.Hash(TimingDummy, "timing-dummy-password"), password);
                return null;
            }

            var now = clock.Now;
            var address = client.Value;
            var throttle = await db.LoginThrottles.SingleOrDefaultAsync(t => t.UserId == user.Id && t.ClientAddress == address, cancellationToken);
            var check = hasher.Verify(user, user.PasswordHash, password);
            if (throttle?.IsLockedOut(now) == true)
                return null;

            if (check == PasswordCheck.Failed)
            {
                if (throttle is null)
                {
                    throttle = LoginThrottle.Create(user.Id, address);
                    db.LoginThrottles.Add(throttle);
                }
                throttle.RegisterFailure(now);
                await db.SaveChangesAsync(cancellationToken);
                return null;
            }

            if (throttle is not null)
                db.LoginThrottles.Remove(throttle);
            if (check == PasswordCheck.SuccessRehashNeeded)
                user.UpgradePasswordHash(hasher.Hash(user, password));
            user.RegisterSuccessfulLogin(now);
            await db.SaveChangesAsync(cancellationToken);
            return user;
        }
    }
}
