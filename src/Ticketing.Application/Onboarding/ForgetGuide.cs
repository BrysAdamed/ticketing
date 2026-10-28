using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Onboarding;

namespace Ticketing.Application.Onboarding;

/// <summary>
/// Forgets one guide the caller completed or dismissed, so it shows again (D-133: Help → Getting started restores a
/// dismissed checklist). Web session only; forgetting a guide that has no row is a no-op.
/// </summary>
public static class ForgetGuide
{
    public sealed record Command(string GuideId);

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser) : IHandler<Command, int>
    {
        public async Task<int> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            UserGuideState.EnsureValidGuideId(command.GuideId);
            currentUser.EnsureCookieSession();
            var me = currentUser.Id;
            return await db.UserGuideStates.Where(s => s.UserId == me && s.GuideId == command.GuideId).ExecuteDeleteAsync(cancellationToken);
        }
    }
}
