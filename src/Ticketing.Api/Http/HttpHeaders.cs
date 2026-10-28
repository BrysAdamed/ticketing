using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using Ticketing.Application.Common;

namespace Ticketing.Api.Http;

/// <summary>
/// Transport headers that feed use cases: <c>If-Match</c> (expected rowVersion) and <c>Idempotency-Key</c>; and content-hash
/// <c>ETag</c> / <c>If-None-Match</c> for small cacheable reads.
/// </summary>
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

    /// <summary>
    /// Serializes <paramref name="value"/> as JSON with a content-hash <c>ETag</c> and <c>Cache-Control: no-cache</c>, so the
    /// browser revalidates every time; a matching <c>If-None-Match</c> gets 304 without a body.
    /// </summary>
    public static IResult JsonWithContentETag<T>(this HttpContext http, T value)
    {
        var options = http.RequestServices.GetRequiredService<IOptions<JsonOptions>>().Value.SerializerOptions;
        var body = JsonSerializer.SerializeToUtf8Bytes(value, options);
        var etag = $"\"{Convert.ToHexStringLower(SHA256.HashData(body))[..32]}\"";
        http.Response.Headers.ETag = etag;
        http.Response.Headers.CacheControl = "no-cache";
        var ifNoneMatch = http.Request.Headers.IfNoneMatch.ToString();
        if (ifNoneMatch.Split(',').Any(tag => tag.Trim() == etag || tag.Trim() == "W/" + etag || tag.Trim() == "*"))
            return TypedResults.StatusCode(StatusCodes.Status304NotModified);
        return TypedResults.Bytes(body, "application/json");
    }
}
