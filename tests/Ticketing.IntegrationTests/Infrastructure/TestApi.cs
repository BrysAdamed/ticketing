using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using ModelContextProtocol.Client;
using Ticketing.Api.Auth;
using Ticketing.Api.Http;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.Infrastructure.Auth;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.IntegrationTests.Infrastructure;

public sealed record TestUser(Guid Id, string Email, string Password, string DisplayName, GlobalRole Role);

/// <summary>
/// The testing API every slice uses: create users and tokens, get clients that behave like the SPA (cookie + XSRF),
/// a script (PAT) or an LLM (MCP), and run code against the database or as a given user.
/// </summary>
public static class TestApi
{
    public const string DefaultPassword = "Correct-Horse-Battery-1";
    private static readonly Uri BaseAddress = new("https://localhost");

    public static async Task<TestUser> CreateUserAsync(
        this TicketingApiFactory api, GlobalRole role = GlobalRole.User, string? email = null, string password = DefaultPassword, string? displayName = null)
    {
        email ??= $"user-{Guid.NewGuid():N}@ticketing.test";
        displayName ??= $"Test {role} {email[..13]}";
        return await api.WithDbAsync(async db =>
        {
            var hasher = api.Services.GetRequiredService<IPasswordHasher>();
            var user = User.Create(email, displayName, role, createdById: null, DateTimeOffset.UtcNow);
            user.SetPasswordHash(hasher.Hash(user, password));
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return new TestUser(user.Id, user.Email, password, user.DisplayName, role);
        });
    }

    /// <summary>A browser-like client: keeps cookies and echoes XSRF-TOKEN as X-XSRF-TOKEN on unsafe requests (like Angular).</summary>
    public static HttpClient CreateBrowserClient(this TicketingApiFactory api, bool sendXsrfHeader = true)
    {
        var cookies = new CookieContainer();
        var handlers = new List<DelegatingHandler>();
        if (sendXsrfHeader)
            handlers.Add(new XsrfHeaderHandler(cookies));
        handlers.Add(new CookieContainerHandler(cookies));
        return api.CreateDefaultClient(BaseAddress, [.. handlers]);
    }

    /// <summary>Signs in through the real endpoints and returns the authenticated browser-like client.</summary>
    public static async Task<HttpClient> LoginAsync(this TicketingApiFactory api, TestUser user, bool sendXsrfHeader = true)
    {
        var client = api.CreateBrowserClient(sendXsrfHeader);
        (await client.GetAsync("/api/v1/auth/csrf")).EnsureSuccessStatusCode();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = user.Password });
        await response.ShouldHaveStatusAsync(HttpStatusCode.OK);
        return client;
    }

    public static async Task<string> CreatePatAsync(
        this TicketingApiFactory api, TestUser user, PatScope scope = PatScope.ReadWrite, TimeSpan? lifetime = null)
    {
        var generator = api.Services.GetRequiredService<IPatTokenGenerator>();
        var generated = generator.Generate();
        await api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            db.PersonalAccessTokens.Add(PersonalAccessToken.Create(
                user.Id, $"test-{Guid.NewGuid():N}", scope, generated.Prefix, generated.Hash, now + (lifetime ?? TimeSpan.FromDays(30)), now));
            return await db.SaveChangesAsync();
        });
        return generated.Token;
    }

    /// <summary>A script-like client authenticated with a fresh PAT (no cookies, no XSRF).</summary>
    public static async Task<HttpClient> CreatePatClientAsync(this TicketingApiFactory api, TestUser user, PatScope scope = PatScope.ReadWrite) =>
        api.CreateBearerClient(await api.CreatePatAsync(user, scope));

    public static HttpClient CreateBearerClient(this TicketingApiFactory api, string token)
    {
        var client = api.CreateDefaultClient(BaseAddress);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>An MCP client over Streamable HTTP against <c>/mcp</c>, authenticated with <paramref name="token"/>.</summary>
    public static async Task<McpClient> CreateMcpClientAsync(this TicketingApiFactory api, string token)
    {
        var http = api.CreateBearerClient(token);
        var transport = new HttpClientTransport(
            new HttpClientTransportOptions { Endpoint = new Uri(BaseAddress, "/mcp"), TransportMode = HttpTransportMode.StreamableHttp },
            http,
            ownsHttpClient: true);
        return await McpClient.CreateAsync(transport, cancellationToken: TestContext.Current.CancellationToken);
    }

    public static async Task<T> WithDbAsync<T>(this TicketingApiFactory api, Func<TicketingDbContext, Task<T>> work)
    {
        await using var scope = api.Services.CreateAsyncScope();
        return await work(scope.ServiceProvider.GetRequiredService<TicketingDbContext>());
    }

    /// <summary>
    /// Runs application code as <paramref name="user"/> without HTTP, for rules that have no endpoint yet.
    /// <paramref name="channel"/> mimics a cookie session (null) or a PAT with the given scope.
    /// </summary>
    public static async Task<T> ExecuteAsAsync<T>(
        this TicketingApiFactory api, TestUser user, Func<IServiceProvider, Task<T>> work, PatScope? patScope = null)
    {
        await using var scope = api.Services.CreateAsyncScope();
        var accessor = scope.ServiceProvider.GetRequiredService<IHttpContextAccessor>();
        var identity = new AuthenticatedUser(user.Id, user.Email, user.DisplayName, user.Role);
        var principal = patScope is null
            ? TicketingPrincipal.ForSession(identity, securityStamp: string.Empty, sessionId: Guid.Empty)
            : TicketingPrincipal.ForPat(new PatAuthentication(identity, Guid.NewGuid(), patScope.Value, DateTimeOffset.UtcNow.AddDays(1)));
        accessor.HttpContext = new DefaultHttpContext { User = principal, RequestServices = scope.ServiceProvider };
        try
        {
            return await work(scope.ServiceProvider);
        }
        finally
        {
            accessor.HttpContext = null;
        }
    }

    private sealed class XsrfHeaderHandler(CookieContainer cookies) : DelegatingHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Method != HttpMethod.Get && request.Method != HttpMethod.Head && request.RequestUri is not null)
            {
                var token = cookies.GetCookies(request.RequestUri)[Xsrf.CookieName]?.Value;
                if (token is not null)
                    request.Headers.TryAddWithoutValidation(Xsrf.HeaderName, token);
            }
            return base.SendAsync(request, cancellationToken);
        }
    }
}
