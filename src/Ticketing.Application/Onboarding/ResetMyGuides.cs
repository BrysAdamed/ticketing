using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;

namespace Ticketing.Application.Onboarding;

/// <summary>Forgets every guide the caller completed or dismissed, so all of them can show again (D-132). Web session only.</summary>
public static class ResetMyGuides
{
    public sealed record Command;

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser) : IHandler<Command, int>
    {
        public async Task<int> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            currentUser.EnsureCookieSession();
            var me = currentUser.Id;
            return await db.UserGuideStates.Where(s => s.UserId == me).ExecuteDeleteAsync(cancellationToken);
        }
    }
}
