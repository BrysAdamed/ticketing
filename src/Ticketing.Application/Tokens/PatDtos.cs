using System.Linq.Expressions;
using Ticketing.Application.Users;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Tokens;

/// <summary>A personal access token as its owner sees it in lists. Never contains the secret.</summary>
public sealed record PatDto(
    Guid Id,
    string Name,
    string Prefix,
    PatScope Scope,
    PatStatus Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? LastUsedAt,
    DateTimeOffset? RevokedAt);

/// <summary>A token in the Admin list, with its owner.</summary>
public sealed record AdminPatDto(
    Guid Id,
    string Name,
    string Prefix,
    PatScope Scope,
    PatStatus Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? LastUsedAt,
    DateTimeOffset? RevokedAt,
    UserLookupDto User);

/// <param name="Secret">The full token. Returned once, at creation; only its hash is stored.</param>
public sealed record CreatedPatDto(PatDto Token, string Secret);

internal static class PatProjections
{
    public static Expression<Func<PersonalAccessToken, PatDto>> ToDto(DateTimeOffset now) => t => new PatDto(
        t.Id,
        t.Name,
        t.Prefix,
        t.Scope,
        t.RevokedAt != null ? PatStatus.Revoked : t.ExpiresAt <= now ? PatStatus.Expired : PatStatus.Active,
        t.CreatedAt,
        t.ExpiresAt,
        t.LastUsedAt,
        t.RevokedAt);

    public static PatDto ToDto(PersonalAccessToken t, DateTimeOffset now) => new(
        t.Id, t.Name, t.Prefix, t.Scope, PersonalAccessToken.StatusOf(t.RevokedAt, t.ExpiresAt, now), t.CreatedAt, t.ExpiresAt, t.LastUsedAt, t.RevokedAt);
}
