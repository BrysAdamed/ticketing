namespace Ticketing.Domain.Tokens;

public static class PatErrors
{
    public const string NotFound = "pat.notFound";
    public const string NameTaken = "pat.name.taken";
    public const string LimitReached = "pat.limitReached";
    public const string ExpiryInvalid = "pat.expiry.invalid";
}
