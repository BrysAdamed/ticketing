using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Users;

/// <summary>
/// An Admin creates a user and receives a one-time set-password link valid 72 hours (spec 6.14). No Idempotency-Key:
/// the result carries a secret that must not be stored for replay; the unique email already makes a retry safe.
/// </summary>
public static class CreateUser
{
    private const string EmailUniqueIndex = "ix_users_email";

    public sealed record Command(string Email, string DisplayName, GlobalRole? GlobalRole = null) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Required("email", Email, User.EmailMaxLength)
            .Required("displayName", DisplayName, User.DisplayNameMaxLength);
    }

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, CreateUserResult>
    {
        public async Task<CreateUserResult> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureAdminWebSession();

            var now = clock.Now;
            var user = User.Create(command.Email, command.DisplayName, command.GlobalRole ?? GlobalRole.User, currentUser.Id, now);
            if (await db.Users.AnyAsync(u => u.Email == user.Email, cancellationToken))
                throw EmailTaken(user.Email);

            var link = SetPasswordLinks.Issue(user, User.NewUserSetPasswordLinkLifetime, now);
            db.Users.Add(user);
            activity.Record(ActivityEntityType.User, user.Id, null, "user.created", new { user.Email, user.DisplayName, user.GlobalRole });
            activity.Record(ActivityEntityType.User, user.Id, null, "user.setPasswordLink.issued", new { link.ExpiresAt });
            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (ex.IsUniqueViolation(EmailUniqueIndex))
            {
                throw EmailTaken(user.Email);
            }

            return new CreateUserResult(await AdminUsers.LoadAsync(db, user.Id, now, cancellationToken), link);
        }

        private static AppException EmailTaken(string email) =>
            new(ErrorKind.Conflict, UserErrors.EmailTaken, $"A user with the email {email} already exists.",
                "Search for the user; a deactivated user can be reactivated.",
                new Dictionary<string, string[]> { ["email"] = ["This email is already in use."] });
    }
}
