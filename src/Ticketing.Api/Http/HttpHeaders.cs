using System.Globalization;
using Ticketing.Application.Common;

namespace Ticketing.Api.Http;

/// <summary>Transport headers that feed use cases: <c>If-Match</c> (expected version) and <c>Idempotency-Key</c>.</summary>
public static class HttpHeaders
{
    public const string IdempotencyKey = "Idempotency-Key";

    /// <summary>Parses <c>If-Match: "42"</c> (quotes and a weak prefix are tolerated); null when absent.</summary>
    public static uint? ExpectedVersion(this HttpRequest request)
    {
        var raw = request.Headers.IfMatch.ToString().Trim();
        if (raw.Length == 0 || raw == "*")
            return null;
        if (raw.StartsWith("W/", StringComparison.Ordinal))
            raw = raw[2..];
        if (uint.TryParse(raw.Trim('"'), NumberStyles.None, CultureInfo.InvariantCulture, out var version))
            return version;
        throw AppException.Invalid("If-Match", "If-Match must be the resource version, for example \"42\".");
    }

    public static string? IdempotencyKeyHeader(this HttpRequest request) =>
        request.Headers.TryGetValue(IdempotencyKey, out var value) ? value.ToString() : null;

    public static void SetVersion(this HttpResponse response, uint version) =>
        response.Headers.ETag = $"\"{version.ToString(CultureInfo.InvariantCulture)}\"";
}
