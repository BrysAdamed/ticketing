using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Infrastructure.Auth;

public sealed record AuthenticatedUser(Guid Id, string Email, string DisplayName, GlobalRole Role);

public sealed record PatAuthentication(AuthenticatedUser User, Guid TokenId, PatScope Scope, DateTimeOffset ExpiresAt);

/// <summary>Data access for the authentication handlers: session revalidation and PAT lookup.</summary>
public interface IAuthenticationStore
{
    /// <summary>The user's current identity, or null when the user no longer exists or is deactivated.</summary>
    Task<AuthenticatedUser?> FindActiveUserAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>Validates a bearer token (active, unexpired, owner active) and records its use at most every 5 minutes.</summary>
    Task<PatAuthentication?> AuthenticatePatAsync(string token, CancellationToken cancellationToken);
}

internal sealed class AuthenticationStore(TicketingDbContext db, IPatTokenGenerator tokens, TimeProvider time) : IAuthenticationStore
{
    public Task<AuthenticatedUser?> FindActiveUserAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId && u.IsActive)
            .Select(u => new AuthenticatedUser(u.Id, u.Email, u.DisplayName, u.GlobalRole))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<PatAuthentication?> AuthenticatePatAsync(string token, CancellationToken cancellationToken)
    {
        if (!token.StartsWith(PersonalAccessToken.TokenPrefix, StringComparison.Ordinal)
            || token.Length != PersonalAccessToken.TokenPrefix.Length + PersonalAccessToken.SecretLength)
            return null;

        var hash = tokens.Hash(token);
        var now = time.GetUtcNow();
        var match = await db.PersonalAccessTokens
            .AsNoTracking()
            .Where(t => t.TokenHash == hash && t.RevokedAt == null && t.ExpiresAt > now)
            .Join(db.Users.Where(u => u.IsActive), t => t.UserId, u => u.Id, (t, u) => new
            {
                t.Id,
                t.Scope,
                t.ExpiresAt,
                t.LastUsedAt,
                User = new AuthenticatedUser(u.Id, u.Email, u.DisplayName, u.GlobalRole),
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (match is null)
            return null;

        if (PersonalAccessToken.ShouldRecordUse(match.LastUsedAt, now))
            await db.PersonalAccessTokens
                .Where(t => t.Id == match.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.LastUsedAt, now), cancellationToken);

        return new PatAuthentication(match.User, match.Id, match.Scope, match.ExpiresAt);
    }
}
