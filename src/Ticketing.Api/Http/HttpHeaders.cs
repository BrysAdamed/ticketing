using System.Globalization;
using Ticketing.Application.Common;

namespace Ticketing.Api.Http;

/// <summary>Transport headers that feed use cases: <c>If-Match</c> (expected rowVersion) and <c>Idempotency-Key</c>.</summary>
public static class HttpHeaders
{
    public const string IdempotencyKey = "Idempotency-Key";

    /// <summary>Parses <c>If-Match: "42"</c> (the resource's <c>rowVersion</c>; quotes and a weak prefix are tolerated); null when absent.</summary>
    public static uint? ExpectedRowVersion(this HttpRequest request)
    {
        var raw = request.Headers.IfMatch.ToString().Trim();
        if (raw.Length == 0 || raw == "*")
            return null;
        if (raw.StartsWith("W/", StringComparison.Ordinal))
            raw = raw[2..];
        if (uint.TryParse(raw.Trim('"'), NumberStyles.None, CultureInfo.InvariantCulture, out var rowVersion))
            return rowVersion;
        throw AppException.Invalid("If-Match", "If-Match must be the resource's rowVersion, for example \"42\".");
    }

    public static string? IdempotencyKeyHeader(this HttpRequest request) =>
        request.Headers.TryGetValue(IdempotencyKey, out var value) ? value.ToString() : null;

    public static void SetRowVersion(this HttpResponse response, uint rowVersion) =>
        response.Headers.ETag = $"\"{rowVersion.ToString(CultureInfo.InvariantCulture)}\"";
}
