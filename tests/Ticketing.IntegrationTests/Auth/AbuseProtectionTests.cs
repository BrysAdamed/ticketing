using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Users;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Auth;

[Collection(nameof(AuthCollection))]
public sealed class AbuseProtectionTests(TicketingApiFactory api)
{
    private const string WrongPassword = "wrong-password-123";
    private static readonly Uri BaseAddress = new("https://localhost");
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Parallel_wrong_passwords_each_count_towards_lockout()
    {
        // Arrange
        var user = await api.CreateUserAsync();

        // Act
        var responses = await Task.WhenAll(Enumerable.Range(0, LoginThrottle.MaxFailedLogins).Select(_ =>
            api.CreateBrowserClient().PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = WrongPassword }, _ct)));
        var correct = await api.CreateBrowserClient().PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = user.Password }, _ct);

        // Assert
        foreach (var response in responses)
            await response.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.invalidCredentials");
        await correct.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.invalidCredentials");
    }

    [Fact]
    public async Task Correct_login_during_parallel_wrong_guesses_never_conflicts()
    {
        // Arrange
        var user = await api.CreateUserAsync();

        // Act
        var responses = await Task.WhenAll(
            Enumerable.Range(0, 3)
                .Select(_ => new { email = user.Email, password = WrongPassword })
                .Append(new { email = user.Email, password = user.Password })
                .Select(body => api.CreateBrowserClient().PostAsJsonAsync("/api/v1/auth/login", body, _ct)));

        // Assert
        Assert.DoesNotContain(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        var failures = await api.WithDbAsync(db => db.LoginThrottles.Where(t => t.UserId == user.Id).SumAsync(t => t.FailedCount, _ct));
        Assert.InRange(failures, 0, 3);
    }

    [Fact]
    public async Task Lockout_applies_to_the_guessing_address_only_and_shows_in_admin()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var user = await api.CreateUserAsync();
        var attacker = ClientFrom("203.0.113.7");
        for (var i = 0; i < LoginThrottle.MaxFailedLogins; i++)
            await attacker.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = WrongPassword }, _ct);

        // Act
        var fromAttacker = await attacker.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = user.Password }, _ct);
        var fromOwner = await ClientFrom("198.51.100.20").PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = user.Password }, _ct);

        // Assert
        await fromAttacker.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.invalidCredentials");
        await fromOwner.ShouldHaveStatusAsync(HttpStatusCode.OK);
        var dto = await (await admin.GetAsync($"/api/v1/admin/users/{user.Id}", _ct)).ReadAsync<AdminUserDto>();
        Assert.NotNull(dto.LockedUntil);
    }

    [Fact]
    public async Task Locked_and_unknown_accounts_answer_like_a_wrong_password()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = ClientFrom("203.0.113.8");
        var known = new List<HttpResponseMessage>();
        var unknown = new List<HttpResponseMessage>();

        // Act
        for (var i = 0; i <= LoginThrottle.MaxFailedLogins; i++)
        {
            known.Add(await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = WrongPassword }, _ct));
            unknown.Add(await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "nobody@ticketing.test", password = WrongPassword }, _ct));
        }

        // Assert
        foreach (var response in known.Concat(unknown))
            await response.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "auth.invalidCredentials");
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
            responses.Add(await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "nobody@ticketing.test", password = WrongPassword }, _ct));

        // Assert
        Assert.All(responses.Take(3), r => Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode));
        await responses[3].ShouldBeProblemAsync(HttpStatusCode.TooManyRequests, "rateLimited");
        Assert.NotNull(responses[3].Headers.RetryAfter);
    }

    [Fact]
    public async Task Forwarded_for_from_an_untrusted_peer_does_not_change_the_rate_limit_partition()
    {
        // Arrange
        await using var limited = api.WithWebHostBuilder(b => b.UseSetting("RateLimiting:LoginPermitsPerMinute", "3"));
        var client = limited.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = BaseAddress });
        client.DefaultRequestHeaders.Add(TicketingApiFactory.RemoteAddressHeader, "203.0.113.9");

        // Act
        var responses = await LoginWithForwardedForAsync(client, i => $"10.9.{i}.1");

        // Assert
        Assert.All(responses.Take(3), r => Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode));
        await responses[3].ShouldBeProblemAsync(HttpStatusCode.TooManyRequests, "rateLimited");
    }

    [Fact]
    public async Task Forwarded_for_from_a_trusted_proxy_identifies_the_client()
    {
        // Arrange
        await using var limited = api.WithWebHostBuilder(b => b
            .UseSetting("RateLimiting:LoginPermitsPerMinute", "3")
            .UseSetting("ForwardedHeaders:KnownNetworks", "172.16.0.0/12, 192.168.0.0/16"));
        var client = limited.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = BaseAddress });
        client.DefaultRequestHeaders.Add(TicketingApiFactory.RemoteAddressHeader, "172.18.0.5");

        // Act
        var distinctClients = await LoginWithForwardedForAsync(client, i => $"10.9.{i}.1");
        var spoofedPrefix = await LoginWithForwardedForAsync(client, i => $"10.8.{i}.1, 198.51.100.9");

        // Assert
        Assert.All(distinctClients, r => Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode));
        Assert.All(spoofedPrefix.Take(3), r => Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode));
        await spoofedPrefix[3].ShouldBeProblemAsync(HttpStatusCode.TooManyRequests, "rateLimited");
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

    private HttpClient ClientFrom(string remoteAddress)
    {
        var client = api.CreateBrowserClient();
        client.DefaultRequestHeaders.Add(TicketingApiFactory.RemoteAddressHeader, remoteAddress);
        return client;
    }

    private async Task<List<HttpResponseMessage>> LoginWithForwardedForAsync(HttpClient client, Func<int, string> forwardedFor)
    {
        var responses = new List<HttpResponseMessage>();
        for (var i = 0; i < 4; i++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
            {
                Content = JsonContent.Create(new { email = "nobody@ticketing.test", password = WrongPassword }),
            };
            request.Headers.Add("X-Forwarded-For", forwardedFor(i));
            responses.Add(await client.SendAsync(request, _ct));
        }
        return responses;
    }
}
