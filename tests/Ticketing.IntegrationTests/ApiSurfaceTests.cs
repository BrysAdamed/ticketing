using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
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
    public async Task Achievements_are_served_only_under_me_for_the_caller()
    {
        // Act
        var document = await (await api.CreateBrowserClient().GetAsync("/api/v1/openapi.json", _ct)).ReadAsync<JsonElement>();

        // Assert
        var paths = document.GetProperty("paths").EnumerateObject().Select(p => p.Name).ToList();
        Assert.Equal(
            ["/api/v1/me/achievements", "/api/v1/me/achievements/seen", "/api/v1/me/achievements/unseen"],
            paths.Where(p => p.Contains("achievement", StringComparison.OrdinalIgnoreCase)).Order(StringComparer.Ordinal));
        var list = document.GetProperty("paths").GetProperty("/api/v1/me/achievements").GetProperty("get");
        Assert.False(list.TryGetProperty("parameters", out var parameters) && parameters.GetArrayLength() > 0);
    }

    [Fact]
    public async Task OpenApi_document_needs_a_signed_in_caller_in_production()
    {
        // Arrange
        await using var production = api.WithWebHostBuilder(b => b.UseEnvironment("Production"));
        var user = await api.CreateUserAsync();
        var anonymous = production.CreateDefaultClient(new Uri("https://localhost"));
        var withToken = production.CreateDefaultClient(new Uri("https://localhost"));
        withToken.DefaultRequestHeaders.Authorization = new("Bearer", await api.CreatePatAsync(user));

        // Act
        var anonymousResponse = await anonymous.GetAsync("/api/v1/openapi.json", _ct);
        var tokenResponse = await withToken.GetAsync("/api/v1/openapi.json", _ct);
        var scalar = await anonymous.GetAsync("/scalar", _ct);

        // Assert
        await anonymousResponse.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
        await tokenResponse.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.NotEqual(HttpStatusCode.OK, scalar.StatusCode);
    }

    [Theory]
    [InlineData("=1+1", "'=1+1")]
    [InlineData("  =HYPERLINK(\"x\")", "\"'  =HYPERLINK(\"\"x\"\")\"")]
    [InlineData("\t=cmd", "'\t=cmd")]
    [InlineData("\r\n@SUM(A1)", "\"'\r\n@SUM(A1)\"")]
    [InlineData(" -2", "' -2")]
    [InlineData("plain text", "plain text")]
    [InlineData("a=b", "a=b")]
    public void Csv_cells_that_a_spreadsheet_would_evaluate_are_neutralised(string value, string expected) =>
        Assert.Equal(expected, Ticketing.Api.Http.Csv.Escape(value));

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
