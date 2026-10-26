using System.Diagnostics;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;

namespace Ticketing.Api.Http;

/// <summary>RFC 9457 problem details with a stable <c>code</c> (api-conventions.md).</summary>
public static class Problems
{
    public static int StatusFor(ErrorKind kind) => kind switch
    {
        ErrorKind.Validation => StatusCodes.Status400BadRequest,
        ErrorKind.Unauthenticated => StatusCodes.Status401Unauthorized,
        ErrorKind.Forbidden => StatusCodes.Status403Forbidden,
        ErrorKind.NotFound => StatusCodes.Status404NotFound,
        ErrorKind.Conflict => StatusCodes.Status409Conflict,
        ErrorKind.Locked => StatusCodes.Status423Locked,
        ErrorKind.TooManyRequests => StatusCodes.Status429TooManyRequests,
        _ => StatusCodes.Status500InternalServerError,
    };

    public static string DefaultCode(int status) => status switch
    {
        StatusCodes.Status400BadRequest => "request.invalid",
        StatusCodes.Status401Unauthorized => AppErrors.Unauthenticated,
        StatusCodes.Status403Forbidden => AppErrors.Forbidden,
        StatusCodes.Status404NotFound => AppErrors.NotFound,
        StatusCodes.Status405MethodNotAllowed => "request.methodNotAllowed",
        StatusCodes.Status429TooManyRequests => AppErrors.RateLimited,
        >= 500 => AppErrors.Internal,
        _ => $"http.{status}",
    };

    public static IResult Create(int status, string code, string title, string? hint = null, IReadOnlyDictionary<string, string[]>? errors = null)
    {
        var extensions = new Dictionary<string, object?> { ["code"] = code };
        if (hint is not null)
            extensions["hint"] = hint;
        if (errors is { Count: > 0 })
            extensions["errors"] = errors;
        return TypedResults.Problem(statusCode: status, title: title, type: TypeFor(code), extensions: extensions);
    }

    public static AppException? ToAppException(Exception exception) => exception switch
    {
        AppException app => app,
        DomainException domain => AppException.From(domain),
        DbUpdateConcurrencyException => AppException.Conflict(
            AppErrors.ConcurrencyConflict, "The resource was changed by someone else.", "Reload it and apply your change again."),
        DbUpdateException update when update.IsUniqueViolation() => AppException.Conflict(AppErrors.Duplicate, "The resource already exists."),
        BadHttpRequestException bad => new AppException(ErrorKind.Validation, "request.invalid", bad.Message),
        _ => null,
    };

    internal static string TypeFor(string code) => $"https://ticketing/errors/{code}";

    internal static void Customize(ProblemDetailsContext context)
    {
        var problem = context.ProblemDetails;
        var status = problem.Status ?? context.HttpContext.Response.StatusCode;
        problem.Extensions.TryAdd("code", DefaultCode(status));
        problem.Extensions.TryAdd("traceId", Activity.Current?.Id ?? context.HttpContext.TraceIdentifier);
        if (problem.Type is null || problem.Type.StartsWith("https://tools.ietf.org", StringComparison.Ordinal))
            problem.Type = TypeFor((string)problem.Extensions["code"]!);
    }
}

/// <summary>Maps expected exceptions (application, domain, concurrency, uniqueness) to problem details; anything else stays a 500.</summary>
internal sealed partial class ApiExceptionHandler(IProblemDetailsService problemDetails, ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var error = Problems.ToAppException(exception);
        if (error is null)
            return false;

        var status = Problems.StatusFor(error.Kind);
        LogHandled(logger, status, error.Code);
        httpContext.Response.StatusCode = status;
        var problem = new ProblemDetails { Status = status, Title = error.Message, Type = Problems.TypeFor(error.Code) };
        problem.Extensions["code"] = error.Code;
        if (error.Hint is not null)
            problem.Extensions["hint"] = error.Hint;
        if (error.Errors.Count > 0)
            problem.Extensions["errors"] = error.Errors;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext { HttpContext = httpContext, ProblemDetails = problem, Exception = exception });
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Request failed with {Status} {Code}.")]
    private static partial void LogHandled(ILogger logger, int status, string code);
}
