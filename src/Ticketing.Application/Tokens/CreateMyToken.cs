using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Tokens;

/// <summary>
/// Creates a PAT for the caller (spec 6.12): web session only, at most 20 active tokens, expiry from a preset
/// (7, 30, 90 default, 365 days) or a custom date at most 365 days out. The secret is returned once and never stored.
/// No Idempotency-Key, because a replay would have to store the secret.
/// </summary>
public static class CreateMyToken
{
    private const string ActiveNameUniqueIndex = "ix_personal_access_tokens_user_id_name_active";

    public sealed record Command(string Name, PatScope? Scope = null, int? ExpiresInDays = null, DateTimeOffset? ExpiresAt = null) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Required("name", Name, PersonalAccessToken.NameMaxLength)
            .Must(ExpiresInDays is null || ExpiresAt is null, "expiresAt", "Send either expiresInDays or expiresAt, not both.")
            .Must(ExpiresInDays is null || PersonalAccessToken.LifetimePresetDays.Contains(ExpiresInDays.Value), "expiresInDays",
                $"expiresInDays must be one of {string.Join(", ", PersonalAccessToken.LifetimePresetDays)}.");
    }

    public sealed class Handler(
        ITicketingDbContext db, ICurrentUser currentUser, IClock clock, IPatTokenGenerator generator, IActivityLog activity)
        : IHandler<Command, CreatedPatDto>
    {
        public Task<CreatedPatDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureCookieSession();
            return db.InTransactionAsync(ct => CreateAsync(command, ct), cancellationToken);
        }

        private async Task<CreatedPatDto> CreateAsync(Command command, CancellationToken cancellationToken)
        {
            var userId = currentUser.Id;
            var now = clock.Now;
            await db.Database.ExecuteSqlAsync($"SELECT 1 FROM users WHERE id = {userId} FOR UPDATE", cancellationToken);

            var activeCount = await db.PersonalAccessTokens.CountAsync(t => t.UserId == userId && t.RevokedAt == null && t.ExpiresAt > now, cancellationToken);
            if (activeCount >= PersonalAccessToken.MaxActivePerUser)
                throw AppException.Conflict(PatErrors.LimitReached, $"You already have {PersonalAccessToken.MaxActivePerUser} active tokens.",
                    "Revoke a token you no longer use first.");

            var expiresAt = command.ExpiresAt ?? now + (command.ExpiresInDays is { } days ? TimeSpan.FromDays(days) : PersonalAccessToken.DefaultLifetime);
            var generated = generator.Generate();
            var token = PersonalAccessToken.Create(userId, command.Name, command.Scope ?? PatScope.ReadWrite, generated.Prefix, generated.Hash, expiresAt, now);

            var normalizedName = token.Name.ToLowerInvariant();
            if (await db.PersonalAccessTokens.AnyAsync(t => t.UserId == userId && t.RevokedAt == null && t.Name.ToLower() == normalizedName, cancellationToken))
                throw NameTaken(token.Name);

            db.PersonalAccessTokens.Add(token);
            activity.Record(ActivityEntityType.PersonalAccessToken, token.Id, null, "pat.created",
                new { token.Name, token.Prefix, token.Scope, token.ExpiresAt, token.UserId });
            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (ex.IsUniqueViolation(ActiveNameUniqueIndex))
            {
                throw NameTaken(token.Name);
            }
            return new CreatedPatDto(PatProjections.ToDto(token, now), generated.Token);
        }

        private static AppException NameTaken(string name) =>
            new(ErrorKind.Conflict, PatErrors.NameTaken, $"You already have a token named '{name}'.",
                "Pick another name, or revoke the old token (expired tokens keep their name until revoked).",
                new Dictionary<string, string[]> { ["name"] = ["A token with this name exists."] });
    }
}
