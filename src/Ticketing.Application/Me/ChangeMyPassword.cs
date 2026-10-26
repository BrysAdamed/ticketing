using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Me;

/// <summary>
/// Changes the caller's password (current one required, web session only). The security stamp rotates, which ends the
/// user's other cookie sessions; the transport re-issues the current session with the returned stamp.
/// </summary>
public static class ChangeMyPassword
{
    public sealed record Command(string CurrentPassword, string NewPassword) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Required("currentPassword", CurrentPassword, 1024)
            .Required("newPassword", NewPassword, 1024);
    }

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IPasswordHasher hasher, IActivityLog activity)
        : IHandler<Command, SessionIdentity>
    {
        public async Task<SessionIdentity> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureCookieSession();
            var user = await AdminUsers.FindTrackedAsync(db, currentUser.Id, cancellationToken);

            if (user.PasswordHash is null || hasher.Verify(user, user.PasswordHash, command.CurrentPassword) == PasswordCheck.Failed)
                throw DomainException.Invalid("currentPassword", UserErrors.CurrentPasswordInvalid, "The current password is incorrect.");
            PasswordPolicy.Validate(command.NewPassword, user.Email, "newPassword");

            user.SetPasswordHash(hasher.Hash(user, command.NewPassword));
            activity.Record(ActivityEntityType.User, user.Id, null, "user.password.changed");
            await db.SaveChangesAsync(cancellationToken);
            return SessionIdentity.For(user);
        }
    }
}
