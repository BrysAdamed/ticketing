using System.Globalization;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Ticketing.Api.Auth;
using Ticketing.Application.Common;

namespace Ticketing.Api.Http;

internal static class RateLimiting
{
    /// <summary>Per-PAT fixed window (spec 6.12: 600 requests per minute, 429 with Retry-After). Cookie sessions are not limited.</summary>
    public static IServiceCollection AddPatRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        var permitsPerMinute = configuration.GetValue("RateLimiting:PatPermitsPerMinute", 600);
        services.AddRateLimiter(options =>
        {
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                context.User.FindFirstValue(TicketingClaims.PatId) is { } patId
                    ? RateLimitPartition.GetFixedWindowLimiter(patId, _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = permitsPerMinute,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    })
                    : RateLimitPartition.GetNoLimiter(string.Empty));
            options.OnRejected = async (rejected, cancellationToken) =>
            {
                var retryAfter = rejected.Lease.TryGetMetadata(MetadataName.RetryAfter, out var delay) ? delay : TimeSpan.FromMinutes(1);
                rejected.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
                await Problems
                    .Create(StatusCodes.Status429TooManyRequests, AppErrors.RateLimited, "Too many requests for this token.")
                    .ExecuteAsync(rejected.HttpContext);
            };
        });
        return services;
    }
}
