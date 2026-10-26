using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Ticketing.IntegrationTests.Infrastructure;

public static class HttpAssertions
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public static async Task<T> ReadAsync<T>(this HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        await response.ShouldHaveStatusAsync(expected);
        return (await response.Content.ReadFromJsonAsync<T>(Json))!;
    }

    public static async Task ShouldHaveStatusAsync(this HttpResponseMessage response, HttpStatusCode expected)
    {
        if (response.StatusCode != expected)
            Assert.Fail($"Expected {(int)expected} {expected} but got {(int)response.StatusCode} {response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
    }

    /// <summary>Asserts an RFC 9457 problem response with the given status and machine code; returns the parsed body.</summary>
    public static async Task<JsonElement> ShouldBeProblemAsync(this HttpResponseMessage response, HttpStatusCode expected, string code)
    {
        await response.ShouldHaveStatusAsync(expected);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(code, body.GetProperty("code").GetString());
        return body;
    }
}
