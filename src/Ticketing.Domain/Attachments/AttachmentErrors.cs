namespace Ticketing.Domain.Attachments;

public static class AttachmentErrors
{
    public const string NotFound = "attachment.notFound";
    public const string TypeNotAllowed = "attachment.type.notAllowed";
    public const string TypeMismatch = "attachment.type.mismatch";
    public const string SizeInvalid = "attachment.size.invalid";
    public const string LimitReached = "attachment.limitReached";
    public const string NotText = "attachment.notText";
    public const string Forbidden = "attachment.forbidden";
}
