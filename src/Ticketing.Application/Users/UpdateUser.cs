using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Users;

/// <summary>Admin edit of display name and global role; demoting the last active Admin fails (spec 4.1).</summary>
public static class UpdateUser
{
    public sealed record Command : IValidatable
    {
        [JsonIgnore]
        public Guid UserId { get; init; }

        public Optional<string> DisplayName { get; init; }

        public Optional<GlobalRole> GlobalRole { get; init; }

        [JsonIgnore]
        public uint? ExpectedVersion { get; init; }

        public void Validate(Validator validator)
        {
            if (DisplayName.HasValue)
                validator.Required("displayName", DisplayName.Value, User.DisplayNameMaxLength);
        }
    }

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IActivityLog activity)
        : IHandler<Command, AdminUserDto>
    {
        public async Task<AdminUserDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureAdminWebSession();
            await db.InTransactionAsync(ct => ApplyAsync(command, ct), cancellationToken);
            return await AdminUsers.LoadAsync(db, command.UserId, clock.Now, cancellationToken);
        }

        private async Task<bool> ApplyAsync(Command command, CancellationToken cancellationToken)
        {
            var demotes = command.GlobalRole is { HasValue: true, Value: not Domain.Users.GlobalRole.Admin };
            if (demotes)
                await AdminUsers.EnsureAnotherActiveAdminAsync(db, command.UserId, cancellationToken);

            var user = await AdminUsers.FindTrackedAsync(db, command.UserId, cancellationToken);
            db.ExpectVersion(user, command.ExpectedVersion);

            if (command.DisplayName.HasValue)
            {
                var oldName = user.DisplayName;
                user.ChangeDisplayName(command.DisplayName.Value);
                activity.RecordChange(ActivityEntityType.User, user.Id, null, "user.field.changed", "displayName", oldName, user.DisplayName);
            }

            if (command.GlobalRole.HasValue)
            {
                var oldRole = user.GlobalRole;
                user.ChangeRole(command.GlobalRole.Value, currentUser.Id);
                activity.RecordChange(ActivityEntityType.User, user.Id, null, "user.field.changed", "globalRole", oldRole, user.GlobalRole);
            }

            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
    }
}
