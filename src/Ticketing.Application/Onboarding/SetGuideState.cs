using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Onboarding;

namespace Ticketing.Application.Onboarding;

/// <summary>
/// Records that the caller completed or dismissed a version of a guide (D-130), web session only. Ids are not looked up
/// (the web client authors them), only checked for shape; at most 200 guides per user, updating a known one always works.
/// </summary>
public static class SetGuideState
{
    /// <param name="Version">The version of the guide the user finished, 1 or more.</param>
    /// <param name="State">Completed or Dismissed.</param>
    public sealed record Command(int? Version, GuideState? State) : IValidatable
    {
        [JsonIgnore]
        public string GuideId { get; init; } = string.Empty;

        public void Validate(Validator validator) => validator
            .Must(Version is not null, "version", "version is required.")
            .Range("version", Version, 1, UserGuideState.MaxVersion)
            .Must(State is null || Enum.IsDefined(State.Value), "state", "state must be Completed or Dismissed.")
            .Must(State is not null, "state", "state is required.");
    }

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock) : IHandler<Command, GuideStateDto>
    {
        public Task<GuideStateDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            UserGuideState.EnsureValidGuideId(command.GuideId);
            command.EnsureValid();
            currentUser.EnsureCookieSession();
            return db.InTransactionAsync(ct => SetAsync(command, ct), cancellationToken);
        }

        private async Task<GuideStateDto> SetAsync(Command command, CancellationToken cancellationToken)
        {
            var me = currentUser.Id;
            await db.Database.ExecuteSqlAsync($"SELECT 1 FROM users WHERE id = {me} FOR UPDATE", cancellationToken);

            var state = await db.UserGuideStates.SingleOrDefaultAsync(s => s.UserId == me && s.GuideId == command.GuideId, cancellationToken);
            if (state is null)
            {
                if (await db.UserGuideStates.CountAsync(s => s.UserId == me, cancellationToken) >= UserGuideState.MaxPerUser)
                    throw AppException.Conflict(OnboardingErrors.GuideLimit, $"You already have {UserGuideState.MaxPerUser} guides recorded.",
                        "Reset your guides to start over.");
                state = UserGuideState.Create(me, command.GuideId, command.Version!.Value, command.State!.Value, clock.Now);
                db.UserGuideStates.Add(state);
            }
            else
            {
                state.Record(command.Version!.Value, command.State!.Value, clock.Now);
            }

            await db.SaveChangesAsync(cancellationToken);
            return GuideStateDto.From(state);
        }
    }
}
