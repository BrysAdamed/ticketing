using System.Net;
using System.Net.Http.Json;
using Ticketing.Application.Users;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Users;

/// <summary>Helpers for the identity slice: onboard users through the real admin and set-password endpoints.</summary>
internal static class IdentityTestApi
{
    public const string NewPassword = "Purple-Elephant-Dances-42";

    public static async Task<CreateUserResult> CreateUserViaAdminAsync(
        this HttpClient adminClient, string? email = null, string displayName = "Jane Doe", GlobalRole role = GlobalRole.User)
    {
        email ??= $"jane-{Guid.NewGuid():N}@ticketing.test";
        var response = await adminClient.PostAsJsonAsync("/api/v1/admin/users", new { email, displayName, globalRole = role.ToString() });
        return await response.ReadAsync<CreateUserResult>(HttpStatusCode.Created);
    }

    public static Task<HttpResponseMessage> SetPasswordAsync(this TicketingApiFactory api, string token, string password) =>
        api.CreateBrowserClient().PostAsJsonAsync("/api/v1/auth/set-password", new { token, password });

    public static Task<HttpResponseMessage> TryLoginAsync(this TicketingApiFactory api, string email, string password) =>
        api.CreateBrowserClient().PostAsJsonAsync("/api/v1/auth/login", new { email, password });

    public static async Task<int> ActivityCountAsync(this TicketingApiFactory api, string action) =>
        await api.WithDbAsync(db => Task.FromResult(db.ActivityEntries.Count(a => a.Action == action)));
}
