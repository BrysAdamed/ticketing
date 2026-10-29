using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Achievements;
using Ticketing.Application.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Me;

/// <summary>
/// Changes the caller's own display name, avatar and achievements opt-out (spec 5.2, 15.11), web session only. Avatar keys are
/// validated against <see cref="AvatarCatalog"/>; null resets the icon to initials or the colour to the hashed default.
/// <c>achievementsHidden</c> is rejected with 404 <c>achievements.disabled</c> while the flag is off for the caller (D-153).
/// </summary>
public static class UpdateMyProfile
{
    public sealed record Command : IValidatable
    {
        public Optional<string> DisplayName { get; init; }

        public Optional<string?> AvatarIcon { get; init; }

        public Optional<string?> AvatarColor { get; init; }

        public Optional<bool> AchievementsHidden { get; init; }

        public void Validate(Validator validator)
        {
            if (DisplayName.HasValue)
                validator.Required("displayName", DisplayName.Value, User.DisplayNameMaxLength);
        }
    }

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IActivityLog activity, AchievementsGate achievements, IClock clock)
        : IHandler<Command, CurrentUserDto>
    {
        public async Task<CurrentUserDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureCookieSession();
            if (command.AchievementsHidden.HasValue)
                await achievements.EnsureEnabledAsync(cancellationToken);

            var user = await db.InTransactionAsync(async ct =>
            {
                var user = await AdminUsers.FindTrackedAsync(db, currentUser.Id, ct);
                Apply(command, user);
                if (command.AchievementsHidden.HasValue)
                    await AchievementParticipation.SetHiddenAsync(db, user, command.AchievementsHidden.Value, clock.Now, ct);
                await db.SaveChangesAsync(ct);
                return user;
            }, cancellationToken);
            return CurrentUserDto.For(user);
        }

        private void Apply(Command command, User user)
        {
            if (command.DisplayName.HasValue)
            {
                var oldName = user.DisplayName;
                user.ChangeDisplayName(command.DisplayName.Value);
                activity.RecordChange(ActivityEntityType.User, user.Id, null, "user.field.changed", "displayName", oldName, user.DisplayName);
            }

            if (command.AvatarIcon.HasValue || command.AvatarColor.HasValue)
            {
                var oldAvatar = new AvatarChange(user.AvatarIcon, user.AvatarColor);
                var keptIcon = AvatarCatalog.IsIcon(user.AvatarIcon) ? user.AvatarIcon : null;
                var keptColor = AvatarCatalog.IsColor(user.AvatarColor) ? user.AvatarColor : null;
                user.ChangeAvatar(command.AvatarIcon.GetValueOrDefault(keptIcon), command.AvatarColor.GetValueOrDefault(keptColor));
                activity.RecordChange(
                    ActivityEntityType.User, user.Id, null, "user.field.changed", "avatar", oldAvatar, new AvatarChange(user.AvatarIcon, user.AvatarColor));
            }
        }
    }

    private sealed record AvatarChange(string? Icon, string? Color);
}
