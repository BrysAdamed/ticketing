using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Auth;

[Collection(nameof(AuthCollection))]
public sealed class AbuseProtectionTests(TicketingApiFactory api)
{
    private static readonly Uri BaseAddress = new("https://localhost");
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Parallel_wrong_passwords_each_count_towards_lockout()
    {
        // Arrange
        var user = await api.CreateUserAsync();

        // Act
        var responses = await Task.WhenAll(Enumerable.Range(0, User.MaxFailedLogins).Select(_ =>
            api.CreateBrowserClient().PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = "wrong-password-123" }, _ct)));
        var correct = await api.CreateBrowserClient().PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = user.Password }, _ct);

        // Assert
        Assert.All(responses, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Locked }));
        await correct.ShouldBeProblemAsync(HttpStatusCode.Locked, "auth.lockedOut");
    }

    [Fact]
    public async Task Correct_login_during_parallel_wrong_guesses_never_conflicts()
    {
        // Arrange
        var user = await api.CreateUserAsync();

        // Act
        var responses = await Task.WhenAll(
            Enumerable.Range(0, 3)
                .Select(_ => new { email = user.Email, password = "wrong-password-123" })
                .Append(new { email = user.Email, password = user.Password })
                .Select(body => api.CreateBrowserClient().PostAsJsonAsync("/api/v1/auth/login", body, _ct)));

        // Assert
        Assert.DoesNotContain(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        var failures = await api.WithDbAsync(db => db.Users.Where(u => u.Id == user.Id).Select(u => u.FailedLoginCount).SingleAsync(_ct));
        Assert.InRange(failures, 0, 3);
    }

    [Fact]
    public async Task Login_is_rate_limited_per_client_ip()
    {
        // Arrange
        await using var limited = api.WithWebHostBuilder(b => b.UseSetting("RateLimiting:LoginPermitsPerMinute", "3"));
        var client = limited.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = BaseAddress });

        // Act
        var responses = new List<HttpResponseMessage>();
        for (var i = 0; i < 4; i++)
            responses.Add(await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "nobody@ticketing.test", password = "wrong-password-123" }, _ct));

        // Assert
        Assert.All(responses.Take(3), r => Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode));
        await responses[3].ShouldBeProblemAsync(HttpStatusCode.TooManyRequests, "rateLimited");
        Assert.NotNull(responses[3].Headers.RetryAfter);
    }

    [Fact]
    public async Task Pat_requests_are_rate_limited_per_token_with_retry_after()
    {
        // Arrange
        await using var limited = api.WithWebHostBuilder(b => b.UseSetting("RateLimiting:PatPermitsPerMinute", "2"));
        var token = await api.CreatePatAsync(await api.CreateUserAsync());
        var client = limited.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = BaseAddress });
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);

        // Act
        var first = await client.GetAsync("/api/v1/me", _ct);
        var second = await client.GetAsync("/api/v1/me", _ct);
        var third = await client.GetAsync("/api/v1/me", _ct);

        // Assert
        await first.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await second.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await third.ShouldBeProblemAsync(HttpStatusCode.TooManyRequests, "rateLimited");
        Assert.True(third.Headers.RetryAfter?.Delta > TimeSpan.Zero);
    }

    [Fact]
    public async Task Deactivated_users_pat_is_rejected()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var user = await api.CreateUserAsync();
        var client = await api.CreatePatClientAsync(user);
        await api.WithDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == user.Id, _ct)).Deactivate(admin.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var response = await client.GetAsync("/api/v1/me", _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
    }
}
