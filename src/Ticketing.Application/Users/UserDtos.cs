using Ticketing.Domain.Users;

namespace Ticketing.Application.Users;

/// <summary>A user as pickers, references and audit rows show it.</summary>
public sealed record UserLookupDto(Guid Id, string Email, string DisplayName, bool IsActive);

/// <summary>
/// A user in the admin screens. <see cref="HasPassword"/> false means the user has not completed onboarding;
/// <see cref="SetPasswordLinkExpiresAt"/> is set while an unused link is still valid.
/// </summary>
public sealed record AdminUserDto(
    Guid Id,
    string Email,
    string DisplayName,
    GlobalRole GlobalRole,
    bool IsActive,
    bool HasPassword,
    DateTimeOffset? SetPasswordLinkExpiresAt,
    DateTimeOffset? LockedUntil,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset? DeactivatedAt,
    int ActiveTokenCount,
    uint RowVersion);

public sealed record CreateUserResult(AdminUserDto User, SetPasswordLinkDto SetPasswordLink);
