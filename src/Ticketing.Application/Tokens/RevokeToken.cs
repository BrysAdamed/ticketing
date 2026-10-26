using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Tokens;

/// <summary>
/// Revokes a token immediately (spec 6.12). Users revoke their own tokens; with <c>AsAdmin</c> an Admin revokes anyone's.
/// Someone else's token is 404 for a non-admin, so token ids do not leak. Revoking twice is a no-op.
/// </summary>
public static class RevokeToken
{
    public sealed record Command(Guid TokenId, bool AsAdmin = false);

    public sealed class Handler(ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IActivityLog activity) : IHandler<Command, PatDto>
    {
        public async Task<PatDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            if (command.AsAdmin)
                currentUser.EnsureAdminWebSession();
            else
                currentUser.EnsureCookieSession();

            var token = await db.PersonalAccessTokens.SingleOrDefaultAsync(t => t.Id == command.TokenId, cancellationToken);
            if (token is null || (!command.AsAdmin && token.UserId != currentUser.Id))
                throw AppException.NotFound(PatErrors.NotFound, "The token was not found.");

            var now = clock.Now;
            if (token.RevokedAt is null)
            {
                token.Revoke(currentUser.Id, now);
                activity.Record(ActivityEntityType.PersonalAccessToken, token.Id, null, "pat.revoked", new { token.Name, token.Prefix, token.UserId });
                await db.SaveChangesAsync(cancellationToken);
            }
            return PatProjections.ToDto(token, now);
        }
    }
}
