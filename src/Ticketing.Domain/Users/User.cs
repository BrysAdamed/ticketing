using System.Net.Mail;
using System.Security.Cryptography;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Users;

public sealed class User
{
    public const int EmailMaxLength = 254;
    public const int DisplayNameMaxLength = 100;
    public const int SecurityStampLength = 32;
    public static readonly TimeSpan NewUserSetPasswordLinkLifetime = TimeSpan.FromHours(72);
    public static readonly TimeSpan ResetSetPasswordLinkLifetime = TimeSpan.FromHours(24);

    private User()
    {
        Email = null!;
        DisplayName = null!;
        SecurityStamp = null!;
    }

    public Guid Id { get; private set; }

    public string Email { get; private set; }

    public string DisplayName { get; private set; }

    public GlobalRole GlobalRole { get; private set; }

    public bool IsActive { get; private set; }

    public string? PasswordHash { get; private set; }

    public string? SetPasswordTokenHash { get; private set; }

    public DateTimeOffset? SetPasswordTokenExpiresAt { get; private set; }

    /// <summary>Changes whenever the password is (re)set; cookie sessions carrying an older stamp are rejected.</summary>
    public string SecurityStamp { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public Guid? CreatedById { get; private set; }

    public DateTimeOffset? LastLoginAt { get; private set; }

    public DateTimeOffset? DeactivatedAt { get; private set; }

    /// <summary>An <see cref="AvatarCatalog.Icons"/> key; null shows initials.</summary>
    public string? AvatarIcon { get; private set; }

    /// <summary>An <see cref="AvatarCatalog.Colors"/> key; null uses the colour hashed from the user id.</summary>
    public string? AvatarColor { get; private set; }

    public Guid? DeactivatedById { get; private set; }

    public uint RowVersion { get; private set; }

    public bool HasPassword => PasswordHash is not null;

    public static User Create(string email, string displayName, GlobalRole role, Guid? createdById, DateTimeOffset now) => new()
    {
        Id = EntityId.New(),
        Email = NormalizeEmail(email),
        DisplayName = Text.SingleLine(displayName, "displayName", DisplayNameMaxLength),
        GlobalRole = role,
        IsActive = true,
        SecurityStamp = NewSecurityStamp(),
        CreatedAt = now,
        CreatedById = createdById,
    };

    public static string NormalizeEmail(string? email)
    {
        var normalized = Text.Required(email, "email", EmailMaxLength).ToLowerInvariant();
        if (!MailAddress.TryCreate(normalized, out var parsed) || parsed.Address != normalized)
            throw DomainException.Invalid("email", UserErrors.EmailInvalid, "Email is not a valid address.");
        return normalized;
    }

    public void RegisterSuccessfulLogin(DateTimeOffset now) => LastLoginAt = now;

    /// <summary>
    /// Sets a new password: consumes any pending set-password link and rotates the security stamp, so every other cookie
    /// session of the user ends.
    /// </summary>
    public void SetPasswordHash(string passwordHash)
    {
        PasswordHash = passwordHash;
        SetPasswordTokenHash = null;
        SetPasswordTokenExpiresAt = null;
        SecurityStamp = NewSecurityStamp();
    }

    /// <summary>Stores a stronger hash of the same password (after a successful login); sessions stay valid.</summary>
    public void UpgradePasswordHash(string passwordHash) => PasswordHash = passwordHash;

    public void IssueSetPasswordToken(string tokenHash, DateTimeOffset expiresAt)
    {
        if (!IsActive)
            throw DomainException.Conflict(UserErrors.Inactive, "Reactivate the user before issuing a set-password link.");
        SetPasswordTokenHash = tokenHash;
        SetPasswordTokenExpiresAt = expiresAt;
    }

    public bool CanRedeemSetPasswordToken(DateTimeOffset now) =>
        IsActive && SetPasswordTokenHash is not null && SetPasswordTokenExpiresAt is { } expiresAt && expiresAt > now;

    public void ChangeDisplayName(string displayName) =>
        DisplayName = Text.SingleLine(displayName, "displayName", DisplayNameMaxLength);

    public void ChangeAvatar(string? icon, string? color)
    {
        if (icon is not null && !AvatarCatalog.IsIcon(icon))
            throw DomainException.Invalid("avatarIcon", UserErrors.AvatarUnknown, $"'{icon}' is not an avatar icon.");
        if (color is not null && !AvatarCatalog.IsColor(color))
            throw DomainException.Invalid(
                "avatarColor", UserErrors.AvatarColorUnknown, $"'{color}' is not an avatar colour.", $"Use one of {string.Join(", ", AvatarCatalog.Colors)}.");
        AvatarIcon = icon;
        AvatarColor = color;
    }

    public void ChangeRole(GlobalRole role, Guid actorId)
    {
        if (actorId == Id && role != GlobalRole)
            throw DomainException.Conflict(UserErrors.SelfRoleChange, "You cannot change your own global role.", "Ask another administrator.");
        GlobalRole = role;
    }

    public void Deactivate(Guid actorId, DateTimeOffset now)
    {
        if (actorId == Id)
            throw DomainException.Conflict(UserErrors.SelfDeactivation, "You cannot deactivate yourself.", "Ask another administrator.");
        if (!IsActive)
            return;
        IsActive = false;
        DeactivatedAt = now;
        DeactivatedById = actorId;
        SetPasswordTokenHash = null;
        SetPasswordTokenExpiresAt = null;
    }

    public void Reactivate()
    {
        IsActive = true;
        DeactivatedAt = null;
        DeactivatedById = null;
    }

    private static string NewSecurityStamp() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(SecurityStampLength / 2));
}
