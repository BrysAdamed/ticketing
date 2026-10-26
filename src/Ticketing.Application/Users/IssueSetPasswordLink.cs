using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Users;

/// <summary>
/// Forgotten password (spec 6.14): a new link valid 24 hours replaces any earlier one. The current password keeps
/// working until the link is used.
/// </summary>
public static class IssueSetPasswordLink
{
    public sealed record Command(Guid UserId);

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, SetPasswordLinkDto>
    {
        public async Task<SetPasswordLinkDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            currentUser.EnsureAdminWebSession();
            var user = await AdminUsers.FindTrackedAsync(db, command.UserId, cancellationToken);
            var link = SetPasswordLinks.Issue(user, User.ResetSetPasswordLinkLifetime, clock.Now);
            activity.Record(ActivityEntityType.User, user.Id, null, "user.setPasswordLink.issued", new { link.ExpiresAt });
            await db.SaveChangesAsync(cancellationToken);
            return link;
        }
    }
}
