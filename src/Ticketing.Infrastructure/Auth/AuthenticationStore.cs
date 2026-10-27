using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Infrastructure.Auth;

public sealed record AuthenticatedUser(Guid Id, string Email, string DisplayName, GlobalRole Role);

/// <summary>An active user and the security stamp their cookie sessions must carry.</summary>
public sealed record ActiveUser(AuthenticatedUser User, string SecurityStamp);

public sealed record PatAuthentication(AuthenticatedUser User, Guid TokenId, PatScope Scope, DateTimeOffset ExpiresAt);

/// <summary>Data access for the authentication handlers: web sessions and PAT lookup.</summary>
public interface IAuthenticationStore
{
    /// <summary>Records a new web session of the user and returns its id, which the session cookie carries.</summary>
    Task<Guid> StartSessionAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>
    /// The user's current identity and security stamp while the session exists and the user is active, otherwise null.
    /// Records activity at most every 5 minutes.
    /// </summary>
    Task<ActiveUser?> FindSessionUserAsync(Guid sessionId, Guid userId, CancellationToken cancellationToken);

    /// <summary>Deletes the session, so its cookie no longer authenticates.</summary>
    Task EndSessionAsync(Guid sessionId, CancellationToken cancellationToken);

    /// <summary>Validates a bearer token (active, unexpired, owner active) and records its use at most every 5 minutes.</summary>
    Task<PatAuthentication?> AuthenticatePatAsync(string token, CancellationToken cancellationToken);

    /// <summary>The user's identity and security stamp while the user is active, otherwise null (signed export links).</summary>
    Task<ActiveUser?> FindActiveUserAsync(Guid userId, CancellationToken cancellationToken);
}

internal sealed class AuthenticationStore(TicketingDbContext db, IPatTokenGenerator tokens, TimeProvider time) : IAuthenticationStore
{
    public async Task<Guid> StartSessionAsync(Guid userId, CancellationToken cancellationToken)
    {
        var session = UserSession.Start(userId, time.GetUtcNow());
        db.UserSessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        return session.Id;
    }

    public async Task<ActiveUser?> FindSessionUserAsync(Guid sessionId, Guid userId, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var cutoff = UserSession.IdleCutoff(now);
        var match = await db.UserSessions
            .AsNoTracking()
            .Where(s => s.Id == sessionId && s.UserId == userId && s.LastSeenAt > cutoff)
            .Join(db.Users.Where(u => u.IsActive), s => s.UserId, u => u.Id, (s, u) => new
            {
                s.LastSeenAt,
                User = new AuthenticatedUser(u.Id, u.Email, u.DisplayName, u.GlobalRole),
                u.SecurityStamp,
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (match is null)
            return null;

        if (UserSession.ShouldTouch(match.LastSeenAt, now))
            await db.UserSessions
                .Where(s => s.Id == sessionId)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.LastSeenAt, now), cancellationToken);

        return new ActiveUser(match.User, match.SecurityStamp);
    }

    public Task EndSessionAsync(Guid sessionId, CancellationToken cancellationToken) =>
        db.UserSessions.Where(s => s.Id == sessionId).ExecuteDeleteAsync(cancellationToken);

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

    public Task<ActiveUser?> FindActiveUserAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking()
            .Where(u => u.Id == userId && u.IsActive)
            .Select(u => new ActiveUser(new AuthenticatedUser(u.Id, u.Email, u.DisplayName, u.GlobalRole), u.SecurityStamp))
            .SingleOrDefaultAsync(cancellationToken);
}
