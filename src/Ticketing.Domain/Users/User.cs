using System.Net.Mail;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Users;

public sealed class User
{
    public const int EmailMaxLength = 254;
    public const int DisplayNameMaxLength = 100;
    public const int MaxFailedLogins = 5;
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    private User()
    {
        Email = null!;
        DisplayName = null!;
    }

    public Guid Id { get; private set; }

    public string Email { get; private set; }

    public string DisplayName { get; private set; }

    public GlobalRole GlobalRole { get; private set; }

    public bool IsActive { get; private set; }

    public string? PasswordHash { get; private set; }

    public string? SetPasswordTokenHash { get; private set; }

    public DateTimeOffset? SetPasswordTokenExpiresAt { get; private set; }

    public int FailedLoginCount { get; private set; }

    public DateTimeOffset? LockedUntil { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public Guid? CreatedById { get; private set; }

    public DateTimeOffset? LastLoginAt { get; private set; }

    public DateTimeOffset? DeactivatedAt { get; private set; }

    public Guid? DeactivatedById { get; private set; }

    public uint RowVersion { get; private set; }

    public static User Create(string email, string displayName, GlobalRole role, Guid? createdById, DateTimeOffset now) => new()
    {
        Id = EntityId.New(),
        Email = NormalizeEmail(email),
        DisplayName = Text.SingleLine(displayName, "displayName", DisplayNameMaxLength),
        GlobalRole = role,
        IsActive = true,
        CreatedAt = now,
        CreatedById = createdById,
    };

    public static string NormalizeEmail(string? email)
    {
        var normalized = Text.Required(email, "email", EmailMaxLength).ToLowerInvariant();
        if (!MailAddress.TryCreate(normalized, out var parsed) || parsed.Address != normalized)
            throw DomainException.Invalid("email", "user.email.invalid", "Email is not a valid address.");
        return normalized;
    }

    public bool IsLockedOut(DateTimeOffset now) => LockedUntil is { } until && until > now;

    /// <summary>Counts a failed password attempt. Returns true when this attempt locked the account.</summary>
    public bool RegisterFailedLogin(DateTimeOffset now)
    {
        FailedLoginCount++;
        if (FailedLoginCount < MaxFailedLogins)
            return false;
        FailedLoginCount = 0;
        LockedUntil = now + LockoutDuration;
        return true;
    }

    public void RegisterSuccessfulLogin(DateTimeOffset now)
    {
        FailedLoginCount = 0;
        LockedUntil = null;
        LastLoginAt = now;
    }

    public void SetPasswordHash(string passwordHash)
    {
        PasswordHash = passwordHash;
        SetPasswordTokenHash = null;
        SetPasswordTokenExpiresAt = null;
    }

    public void IssueSetPasswordToken(string tokenHash, DateTimeOffset expiresAt)
    {
        SetPasswordTokenHash = tokenHash;
        SetPasswordTokenExpiresAt = expiresAt;
    }

    public void ChangeDisplayName(string displayName) =>
        DisplayName = Text.SingleLine(displayName, "displayName", DisplayNameMaxLength);

    public void ChangeRole(GlobalRole role, Guid actorId)
    {
        if (actorId == Id && role != GlobalRole)
            throw DomainException.Conflict("user.selfRoleChange", "You cannot change your own global role.");
        GlobalRole = role;
    }

    public void Deactivate(Guid actorId, DateTimeOffset now)
    {
        if (actorId == Id)
            throw DomainException.Conflict("user.selfDeactivation", "You cannot deactivate yourself.");
        if (!IsActive)
            return;
        IsActive = false;
        DeactivatedAt = now;
        DeactivatedById = actorId;
    }

    public void Reactivate()
    {
        IsActive = true;
        DeactivatedAt = null;
        DeactivatedById = null;
    }
}
