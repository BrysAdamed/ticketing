using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests;

[Collection(nameof(AuthCollection))]
public sealed class ApiSurfaceTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("/health/live")]
    [InlineData("/health/ready")]
    public async Task Health_endpoints_are_anonymous_and_healthy(string path)
    {
        // Act
        var response = await api.CreateBrowserClient().GetAsync(path, _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task OpenApi_document_is_served_with_string_enums()
    {
        // Act
        var document = await (await api.CreateBrowserClient().GetAsync("/api/v1/openapi.json", _ct)).ReadAsync<JsonElement>();

        // Assert
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/v1/projects", out _));
        var visibility = document.GetProperty("components").GetProperty("schemas").GetProperty("ProjectVisibility");
        Assert.Equal(["Private", "Public"], visibility.GetProperty("enum").EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public async Task Timestamps_are_utc_iso_8601_with_z()
    {
        // Arrange
        var client = await api.CreatePatClientAsync(await api.CreateUserAsync());

        // Act
        var project = await (await client.PostAsJsonAsync("/api/v1/projects", new { key = "TIME", name = "Time" }, _ct)).ReadAsync<JsonElement>(HttpStatusCode.Created);

        // Assert
        Assert.EndsWith("Z", project.GetProperty("createdAt").GetString(), StringComparison.Ordinal);
    }
}
