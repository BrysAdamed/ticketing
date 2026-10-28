namespace Ticketing.Domain.Users;

public static class UserErrors
{
    public const string LastAdmin = "user.lastAdmin";
    public const string LastProjectOwner = "user.lastProjectOwner";
    public const string EmailTaken = "user.emailTaken";
    public const string EmailInvalid = "user.email.invalid";
    public const string NotFound = "user.notFound";
    public const string Inactive = "user.inactive";
    public const string SelfRoleChange = "user.selfRoleChange";
    public const string SelfDeactivation = "user.selfDeactivation";
    public const string SetPasswordTokenInvalid = "user.setPasswordToken.invalid";
    public const string PasswordTooShort = "user.password.tooShort";
    public const string PasswordTooLong = "user.password.tooLong";
    public const string PasswordEqualsEmail = "user.password.equalsEmail";
    public const string PasswordTooCommon = "user.password.tooCommon";
    public const string CurrentPasswordInvalid = "user.password.currentInvalid";
    public const string AvatarUnknown = "user.avatar.unknown";
    public const string AvatarColorUnknown = "user.avatar.color.unknown";
}
