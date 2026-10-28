using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Users;

/// <summary>TKT-69 / D-129: picking a predefined avatar over <c>PATCH /me</c> and the <c>GET /users/avatars</c> directory.</summary>
[Collection(nameof(UsersCollection))]
public sealed class AvatarTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_user_sets_an_avatar_and_it_appears_in_the_directory()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);

        // Act
        var me = await (await client.PatchAsJsonAsync("/api/v1/me", new { avatarIcon = "cat", avatarColor = "teal" }, _ct)).ReadAsync<CurrentUserDto>();
        var directory = await DirectoryAsync(client);

        // Assert
        Assert.Equal(user.Id, me.Id);
        Assert.Equal(new UserAvatarDto(user.Id, "cat", "teal"), directory.Single(a => a.Id == user.Id));
        var entry = await api.WithDbAsync(db => db.ActivityEntries.SingleAsync(a => a.EntityId == user.Id && a.Action == "user.field.changed", _ct));
        Assert.Equal("avatar", entry.Field);
        Assert.Null(JsonDocument.Parse(entry.OldValue!).RootElement.GetProperty("icon").GetString());
        Assert.Equal("cat", JsonDocument.Parse(entry.NewValue!).RootElement.GetProperty("icon").GetString());
    }

    [Fact]
    public async Task Fields_change_independently_and_null_resets_to_initials()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.PatchAsJsonAsync("/api/v1/me", new { avatarIcon = "dog", avatarColor = "pink" }, _ct);

        // Act
        await client.PatchAsJsonAsync("/api/v1/me", new { avatarColor = "green" }, _ct);
        var colourChanged = (await DirectoryAsync(client)).Single(a => a.Id == user.Id);
        await client.PatchAsJsonAsync("/api/v1/me", new { avatarIcon = (string?)null }, _ct);
        var iconReset = (await DirectoryAsync(client)).Single(a => a.Id == user.Id);
        await client.PatchAsJsonAsync("/api/v1/me", new { avatarIcon = (string?)null, avatarColor = (string?)null }, _ct);
        var reset = await DirectoryAsync(client);

        // Assert
        Assert.Equal(new UserAvatarDto(user.Id, "dog", "green"), colourChanged);
        Assert.Equal(new UserAvatarDto(user.Id, null, "green"), iconReset);
        Assert.DoesNotContain(reset, a => a.Id == user.Id);
        var stored = await api.WithDbAsync(db => db.Users.SingleAsync(u => u.Id == user.Id, _ct));
        Assert.Null(stored.AvatarIcon);
        Assert.Null(stored.AvatarColor);
    }

    [Theory]
    [InlineData("unicorn", null, "avatarIcon", UserErrors.AvatarUnknown)]
    [InlineData("Cat", null, "avatarIcon", UserErrors.AvatarUnknown)]
    [InlineData(null, "magenta", "avatarColor", UserErrors.AvatarColorUnknown)]
    [InlineData(null, "3", "avatarColor", UserErrors.AvatarColorUnknown)]
    public async Task Unknown_keys_are_rejected_with_stable_codes(string? icon, string? color, string field, string code)
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        var body = new Dictionary<string, string?> { [field] = icon ?? color };

        // Act
        var response = await client.PatchAsJsonAsync("/api/v1/me", body, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, code);
        var stored = await api.WithDbAsync(db => db.Users.SingleAsync(u => u.Id == user.Id, _ct));
        Assert.Null(stored.AvatarIcon);
        Assert.Null(stored.AvatarColor);
    }

    [Fact]
    public async Task A_personal_access_token_cannot_change_the_avatar()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.CreatePatClientAsync(user, PatScope.ReadWrite);

        // Act
        var response = await client.PatchAsJsonAsync("/api/v1/me", new { avatarIcon = "cat" }, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.CookieSessionRequired);
        Assert.Null(await api.WithDbAsync(db => db.Users.Where(u => u.Id == user.Id).Select(u => u.AvatarIcon).SingleAsync(_ct)));
    }

    [Fact]
    public async Task The_directory_revalidates_with_a_content_etag()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.PatchAsJsonAsync("/api/v1/me", new { avatarIcon = "fish" }, _ct);

        // Act
        var first = await client.GetAsync("/api/v1/users/avatars", _ct);
        var etag = first.Headers.ETag!;
        var unchanged = await GetIfNoneMatchAsync(client, etag);
        await client.PatchAsJsonAsync("/api/v1/me", new { avatarIcon = "pig" }, _ct);
        var changed = await GetIfNoneMatchAsync(client, etag);

        // Assert
        await first.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.False(etag.IsWeak);
        Assert.True(first.Headers.CacheControl!.NoCache);
        Assert.Equal(HttpStatusCode.NotModified, unchanged.StatusCode);
        Assert.Empty(await unchanged.Content.ReadAsByteArrayAsync(_ct));
        Assert.Equal(etag, unchanged.Headers.ETag);
        await changed.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.NotEqual(etag, changed.Headers.ETag);
        Assert.Equal("pig", (await changed.ReadAsync<List<UserAvatarDto>>()).Single(a => a.Id == user.Id).Icon);
    }

    [Fact]
    public async Task Deactivated_users_stay_in_the_directory()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var user = await api.CreateUserAsync();
        await (await api.LoginAsync(user)).PatchAsJsonAsync("/api/v1/me", new { avatarIcon = "deer", avatarColor = "amber" }, _ct);

        // Act
        await (await admin.PostAsync($"/api/v1/admin/users/{user.Id}/deactivate", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var directory = await DirectoryAsync(admin);

        // Assert
        Assert.Equal(new UserAvatarDto(user.Id, "deer", "amber"), directory.Single(a => a.Id == user.Id));
    }

    [Fact]
    public async Task Keys_that_left_the_catalogue_are_left_out()
    {
        // Arrange
        var retiredIcon = await api.CreateUserAsync();
        var retiredBoth = await api.CreateUserAsync();
        await api.WithDbAsync(db => db.Database.ExecuteSqlAsync(
            $"UPDATE users SET avatar_icon = 'dodo', avatar_color = 'blue' WHERE id = {retiredIcon.Id}", _ct));
        await api.WithDbAsync(db => db.Database.ExecuteSqlAsync(
            $"UPDATE users SET avatar_icon = 'dodo', avatar_color = 'sepia' WHERE id = {retiredBoth.Id}", _ct));
        var client = await api.LoginAsync(retiredIcon);

        // Act
        var directory = await DirectoryAsync(client);
        var recolour = await client.PatchAsJsonAsync("/api/v1/me", new { avatarColor = "violet" }, _ct);

        // Assert
        Assert.Equal(new UserAvatarDto(retiredIcon.Id, null, "blue"), directory.Single(a => a.Id == retiredIcon.Id));
        Assert.DoesNotContain(directory, a => a.Id == retiredBoth.Id);
        await recolour.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(new UserAvatarDto(retiredIcon.Id, null, "violet"), (await DirectoryAsync(client)).Single(a => a.Id == retiredIcon.Id));
    }

    [Fact]
    public async Task Mcp_whoami_and_find_users_do_not_expose_the_avatar()
    {
        // Arrange
        var user = await api.CreateUserAsync(displayName: "Avatar Mcp");
        await (await api.LoginAsync(user)).PatchAsJsonAsync("/api/v1/me", new { avatarIcon = "bat", avatarColor = "cyan" }, _ct);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));

        // Act
        var whoami = await CallAsync(mcp, "whoami", []);
        var found = await CallAsync(mcp, "find_users", new() { ["query"] = user.Email });

        // Assert
        Assert.Equal(
            ["displayName", "email", "globalRole", "serverVersion", "tokenExpiresAt", "tokenScope"],
            whoami.EnumerateObject().Select(p => p.Name).Order());
        var item = Assert.Single(found.GetProperty("items").EnumerateArray());
        Assert.Equal(["displayName", "email", "id", "isActive"], item.EnumerateObject().Select(p => p.Name).Order());
    }

    private async Task<List<UserAvatarDto>> DirectoryAsync(HttpClient client) =>
        await (await client.GetAsync("/api/v1/users/avatars", _ct)).ReadAsync<List<UserAvatarDto>>();

    private Task<HttpResponseMessage> GetIfNoneMatchAsync(HttpClient client, System.Net.Http.Headers.EntityTagHeaderValue etag)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/users/avatars");
        request.Headers.IfNoneMatch.Add(etag);
        return client.SendAsync(request, _ct);
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        Assert.False(result.IsError == true, $"{tool} failed: {(result.Content.FirstOrDefault() as TextContentBlock)?.Text}");
        return JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }
}
