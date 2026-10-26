namespace Ticketing.Domain.Common;

/// <summary>
/// A violated domain rule. <see cref="Code"/> is the stable machine-readable code that clients branch on
/// (for example <c>ticket.parent.cycle</c>); the message is for humans and may change.
/// </summary>
public sealed class DomainException : Exception
{
    public DomainException(string code, string message, DomainErrorKind kind = DomainErrorKind.Conflict, string? field = null, string? hint = null)
        : base(message)
    {
        Code = code;
        Kind = kind;
        Field = field;
        Hint = hint;
    }

    public string Code { get; }

    public DomainErrorKind Kind { get; }

    /// <summary>The input field (camelCase, as on the wire) the error relates to, if any.</summary>
    public string? Field { get; }

    /// <summary>Optional advice on how to fix the problem; surfaced to MCP clients.</summary>
    public string? Hint { get; }

    public static DomainException Invalid(string field, string code, string message, string? hint = null) =>
        new(code, message, DomainErrorKind.Validation, field, hint);

    public static DomainException Conflict(string code, string message, string? hint = null) =>
        new(code, message, DomainErrorKind.Conflict, hint: hint);

    public static DomainException Forbidden(string code, string message) =>
        new(code, message, DomainErrorKind.Forbidden);
}

/// <summary>How a <see cref="DomainException"/> is reported: Validation = 400, Conflict = 409, Forbidden = 403.</summary>
public enum DomainErrorKind
{
    Validation = 1,
    Conflict = 2,
    Forbidden = 3,
}
