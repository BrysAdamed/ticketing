using System.Globalization;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Ticketing.Api.Auth;
using Ticketing.Application.Common;

namespace Ticketing.Api.Http;

public static class RateLimiting
{
    /// <summary>Per client IP fixed window on <c>POST /auth/login</c>, on top of the account lockout.</summary>
    public const string LoginPolicy = "login";

    /// <summary>
    /// Per-PAT fixed window (spec 6.12: 600 requests per minute) for every request, and the login policy. Rejections are
    /// 429 problem details with <c>Retry-After</c>. Cookie sessions are not limited.
    /// </summary>
    internal static IServiceCollection AddTicketingRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        var patPermits = configuration.GetValue("RateLimiting:PatPermitsPerMinute", 600);
        var loginPermits = configuration.GetValue("RateLimiting:LoginPermitsPerMinute", 20);
        services.AddRateLimiter(options =>
        {
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                context.User.FindFirstValue(TicketingClaims.PatId) is { } patId
                    ? RateLimitPartition.GetFixedWindowLimiter(patId, _ => PerMinute(patPermits))
                    : RateLimitPartition.GetNoLimiter(string.Empty));
            options.AddPolicy(LoginPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => PerMinute(loginPermits)));
            options.OnRejected = async (rejected, cancellationToken) =>
            {
                var retryAfter = rejected.Lease.TryGetMetadata(MetadataName.RetryAfter, out var delay) ? delay : TimeSpan.FromMinutes(1);
                rejected.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
                await Problems
                    .Create(StatusCodes.Status429TooManyRequests, AppErrors.RateLimited, "Too many requests. Try again later.")
                    .ExecuteAsync(rejected.HttpContext);
            };
        });
        return services;
    }

    private static FixedWindowRateLimiterOptions PerMinute(int permits) => new()
    {
        PermitLimit = permits,
        Window = TimeSpan.FromMinutes(1),
        QueueLimit = 0,
    };
}
