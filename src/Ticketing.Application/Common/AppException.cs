using Ticketing.Domain.Common;

namespace Ticketing.Application.Common;

/// <summary>
/// An expected failure of a use case. Transports map <see cref="Kind"/> to a status (REST problem details) or an
/// error result (MCP <c>{ code, message, hint }</c>). Domain rule violations are converted with <see cref="From"/>.
/// </summary>
public sealed class AppException : Exception
{
    private static readonly IReadOnlyDictionary<string, string[]> NoErrors = new Dictionary<string, string[]>();

    public AppException(ErrorKind kind, string code, string message, string? hint = null, IReadOnlyDictionary<string, string[]>? errors = null)
        : base(message)
    {
        Kind = kind;
        Code = code;
        Hint = hint;
        Errors = errors ?? NoErrors;
    }

    public ErrorKind Kind { get; }

    public string Code { get; }

    public string? Hint { get; }

    /// <summary>Per-field messages keyed by the camelCase input name.</summary>
    public IReadOnlyDictionary<string, string[]> Errors { get; }

    /// <summary>Extra machine-readable members (camelCase) added to the problem details and the MCP error, for example the current version on a conflict.</summary>
    public IReadOnlyDictionary<string, object?>? Details { get; init; }

    public static AppException NotFound(string code, string message) => new(ErrorKind.NotFound, code, message);

    public static AppException Forbidden(string code, string message, string? hint = null) => new(ErrorKind.Forbidden, code, message, hint);

    public static AppException Conflict(string code, string message, string? hint = null) => new(ErrorKind.Conflict, code, message, hint);

    public static AppException Unauthenticated(string code, string message) => new(ErrorKind.Unauthenticated, code, message);

    public static AppException Validation(IReadOnlyDictionary<string, string[]> errors) =>
        new(ErrorKind.Validation, AppErrors.Validation, "One or more fields are invalid.", errors: errors);

    public static AppException Invalid(string field, string message) =>
        Validation(new Dictionary<string, string[]> { [field] = [message] });

    public static AppException From(DomainException exception)
    {
        var kind = exception.Kind switch
        {
            DomainErrorKind.Validation => ErrorKind.Validation,
            DomainErrorKind.Forbidden => ErrorKind.Forbidden,
            _ => ErrorKind.Conflict,
        };
        var errors = exception.Field is null ? null : new Dictionary<string, string[]> { [exception.Field] = [exception.Message] };
        return new AppException(kind, exception.Code, exception.Message, exception.Hint, errors);
    }
}

public enum ErrorKind
{
    Validation,
    Unauthenticated,
    Forbidden,
    NotFound,
    Conflict,
    TooManyRequests,
}

/// <summary>Cross-cutting error codes. Feature-specific codes live next to their aggregate (for example <c>TicketErrors</c>).</summary>
public static class AppErrors
{
    public const string Validation = "validation";
    public const string Unauthenticated = "auth.unauthenticated";
    public const string InvalidCredentials = "auth.invalidCredentials";
    public const string CookieSessionRequired = "auth.cookieSessionRequired";
    public const string Forbidden = "forbidden";
    public const string NotFound = "notFound";
    public const string ConcurrencyConflict = "concurrency.conflict";
    public const string Duplicate = "conflict.duplicate";
    public const string ReadOnlyToken = "pat.readOnlyScope";
    public const string XsrfInvalid = "xsrf.invalid";
    public const string RateLimited = "rateLimited";
    public const string IdempotencyKeyReused = "idempotency.keyReused";
    public const string InvalidCursor = "cursor.invalid";
    public const string Internal = "internal";
}
