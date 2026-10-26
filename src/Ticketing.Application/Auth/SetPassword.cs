using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Auth;

/// <summary>
/// Public (anonymous) redemption of a set-password link, used for onboarding and resets (spec 6.14). The link is single
/// use; setting the password ends every existing session of the user. Unknown, used and expired links all give the same
/// 404 <c>user.setPasswordToken.invalid</c>.
/// </summary>
public static class SetPassword
{
    public sealed record Command(string Token, string Password) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Required("token", Token, 200)
            .Required("password", Password, 1024);
    }

    /// <summary>Checks a link before the form is shown.</summary>
    public sealed record InspectQuery(string Token);

    public sealed record LinkInfo(string Email, string DisplayName, bool IsNewUser, DateTimeOffset ExpiresAt);

    public sealed class Handler(ITicketingDbContext db, IPasswordHasher hasher, IClock clock) : IHandler<Command, bool>
    {
        public async Task<bool> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var user = await FindRedeemableAsync(db, command.Token, clock.Now, tracked: true, cancellationToken);
            PasswordPolicy.Validate(command.Password, user.Email);

            var isNewUser = !user.HasPassword;
            user.SetPasswordHash(hasher.Hash(user, command.Password));
            db.ActivityEntries.Add(ActivityEntry.Create(
                ActivityEntityType.User, user.Id, null, user.Id, WriteChannel.Web, clock.Now, isNewUser ? "user.password.set" : "user.password.reset"));
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
    }

    public sealed class InspectHandler(ITicketingDbContext db, IClock clock) : IHandler<InspectQuery, LinkInfo>
    {
        public async Task<LinkInfo> HandleAsync(InspectQuery request, CancellationToken cancellationToken)
        {
            var user = await FindRedeemableAsync(db, request.Token ?? string.Empty, clock.Now, tracked: false, cancellationToken);
            return new LinkInfo(user.Email, user.DisplayName, !user.HasPassword, user.SetPasswordTokenExpiresAt!.Value);
        }
    }

    private static async Task<User> FindRedeemableAsync(ITicketingDbContext db, string token, DateTimeOffset now, bool tracked, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token))
            throw InvalidLink();
        var hash = SetPasswordLinks.Hash(token);
        var users = tracked ? db.Users : db.Users.AsNoTracking();
        var user = await users.SingleOrDefaultAsync(u => u.SetPasswordTokenHash == hash, cancellationToken);
        return user is not null && user.CanRedeemSetPasswordToken(now) ? user : throw InvalidLink();
    }

    private static AppException InvalidLink() =>
        new(ErrorKind.NotFound, UserErrors.SetPasswordTokenInvalid, "This link is invalid, was already used or has expired.",
            "Ask an administrator for a new set-password link.");
}
