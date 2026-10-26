using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Me;

/// <summary>Changes the caller's own display name (spec 5.2), web session only.</summary>
public static class UpdateMyProfile
{
    public sealed record Command : IValidatable
    {
        public Optional<string> DisplayName { get; init; }

        public void Validate(Validator validator)
        {
            if (DisplayName.HasValue)
                validator.Required("displayName", DisplayName.Value, User.DisplayNameMaxLength);
        }
    }

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IActivityLog activity) : IHandler<Command, CurrentUserDto>
    {
        public async Task<CurrentUserDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureCookieSession();
            var user = await AdminUsers.FindTrackedAsync(db, currentUser.Id, cancellationToken);

            if (command.DisplayName.HasValue)
            {
                var oldName = user.DisplayName;
                user.ChangeDisplayName(command.DisplayName.Value);
                activity.RecordChange(ActivityEntityType.User, user.Id, null, "user.field.changed", "displayName", oldName, user.DisplayName);
            }

            await db.SaveChangesAsync(cancellationToken);
            return new CurrentUserDto(user.Id, user.Email, user.DisplayName, user.GlobalRole);
        }
    }
}
