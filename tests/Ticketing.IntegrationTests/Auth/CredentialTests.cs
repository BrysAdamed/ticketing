using System.Net;
using System.Net.Http.Json;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Auth;

[Collection(nameof(AuthCollection))]
public sealed class CredentialTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Cookie_write_without_xsrf_header_is_rejected()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync(), sendXsrfHeader: false);

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/projects", new { key = "XSRF", name = "Xsrf" }, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "xsrf.invalid");
    }

    [Fact]
    public async Task Cookie_write_with_xsrf_header_is_accepted()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/projects", new { key = "XSRF", name = "Xsrf" }, _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Pat_write_needs_no_xsrf_header()
    {
        // Arrange
        var client = await api.CreatePatClientAsync(await api.CreateUserAsync());

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/projects", new { key = "PAT", name = "Pat" }, _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Read_only_pat_can_read_but_not_write()
    {
        // Arrange
        var client = await api.CreatePatClientAsync(await api.CreateUserAsync(), PatScope.ReadOnly);

        // Act
        var read = await client.GetAsync("/api/v1/projects", _ct);
        var write = await client.PostAsJsonAsync("/api/v1/projects", new { key = "RO", name = "Read only" }, _ct);

        // Assert
        await read.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await write.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "pat.readOnlyScope");
    }

    [Fact]
    public async Task Expired_or_revoked_pat_is_rejected()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var token = await api.CreatePatAsync(user);
        await api.WithDbAsync(async db =>
        {
            foreach (var pat in db.PersonalAccessTokens)
                pat.Revoke(user.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var response = await api.CreateBearerClient(token).GetAsync("/api/v1/me", _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
    }
}
