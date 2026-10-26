using System.Net;
using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Users;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Users;

[Collection(nameof(UsersCollection))]
public sealed class FindUsersTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Matches_email_prefix_or_the_start_of_a_name_word_case_insensitively()
    {
        // Arrange
        var caller = await api.LoginAsync(await api.CreateUserAsync(displayName: "Caller"));
        await api.CreateUserAsync(email: "jane.doe@ticketing.test", displayName: "Jane Doe");
        await api.CreateUserAsync(email: "john@ticketing.test", displayName: "John Doerr");
        await api.CreateUserAsync(email: "mary@ticketing.test", displayName: "Mary Ann");

        // Act
        var byEmail = await Find(caller, "/api/v1/users?query=JANE.");
        var byWord = await Find(caller, "/api/v1/users?query=doe");
        var middle = await Find(caller, "/api/v1/users?query=oe");
        var wildcard = await Find(caller, "/api/v1/users?query=%25");

        // Assert
        Assert.Equal(["Jane Doe"], byEmail.Select(u => u.DisplayName));
        Assert.Equal(["Jane Doe", "John Doerr"], byWord.Select(u => u.DisplayName));
        Assert.Empty(middle);
        Assert.Empty(wildcard);
    }

    [Fact]
    public async Task Inactive_users_are_hidden_unless_asked_for_and_results_are_capped()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin, displayName: "Admin");
        var caller = await api.LoginAsync(admin);
        for (var i = 0; i < 22; i++)
            await api.CreateUserAsync(displayName: $"Bulk {i:00}");
        var gone = await api.CreateUserAsync(displayName: "Bulk Gone");
        await (await caller.PostAsync($"/api/v1/admin/users/{gone.Id}/deactivate", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var active = await Find(caller, "/api/v1/users?query=bulk");
        var withInactive = await Find(caller, "/api/v1/users?query=bulk%20g&includeInactive=true");
        var withoutInactive = await Find(caller, "/api/v1/users?query=bulk%20g");

        // Assert
        Assert.Equal(FindUsers.MaxResults, active.Count);
        Assert.All(active, u => Assert.True(u.IsActive));
        Assert.False(Assert.Single(withInactive).IsActive);
        Assert.Empty(withoutInactive);
    }

    [Fact]
    public async Task With_a_private_project_only_writers_and_admins_are_returned_and_outsiders_get_404()
    {
        // Arrange
        var owner = await api.CreateUserAsync(displayName: "Pat Owner");
        var member = await api.CreateUserAsync(displayName: "Pat Member");
        var viewer = await api.CreateUserAsync(displayName: "Pat Viewer");
        var outsider = await api.CreateUserAsync(displayName: "Pat Outsider");
        var admin = await api.CreateUserAsync(GlobalRole.Admin, displayName: "Pat Admin");
        await api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var secret = Project.Create("SECRET", "Secret", null, ProjectVisibility.Private, owner.Id, now);
            secret.AddMember(member.Id, ProjectRole.Member, owner.Id, now);
            secret.AddMember(viewer.Id, ProjectRole.Viewer, owner.Id, now);
            db.Projects.Add(secret);
            db.Projects.Add(Project.Create("OPEN", "Open", null, ProjectVisibility.Public, owner.Id, now));
            return await db.SaveChangesAsync(_ct);
        });
        var ownerClient = await api.LoginAsync(owner);
        var outsiderClient = await api.LoginAsync(outsider);

        // Act
        var writers = await Find(ownerClient, "/api/v1/users?query=pat&projectKey=secret");
        var publicWriters = await Find(outsiderClient, "/api/v1/users?query=pat&projectKey=OPEN");
        var leak = await outsiderClient.GetAsync("/api/v1/users?query=pat&projectKey=SECRET", _ct);

        // Assert
        Assert.Equal(["Pat Admin", "Pat Member", "Pat Owner"], writers.Select(u => u.DisplayName));
        Assert.Equal(5, publicWriters.Count);
        Assert.Contains(admin.Id, publicWriters.Select(u => u.Id));
        await leak.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
    }

    [Fact]
    public async Task Find_users_mcp_tool_uses_the_same_rules()
    {
        // Arrange
        var user = await api.CreateUserAsync(displayName: "Mcp Caller");
        await api.CreateUserAsync(email: "target@ticketing.test", displayName: "Target Person");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, Domain.Tokens.PatScope.ReadOnly));

        // Act
        var tools = (await mcp.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).ToList();
        var found = await mcp.CallToolAsync("find_users", new Dictionary<string, object?> { ["query"] = "targ" }, cancellationToken: _ct);
        var hidden = await mcp.CallToolAsync("find_users", new Dictionary<string, object?> { ["query"] = "x", ["projectKey"] = "NOPE" }, cancellationToken: _ct);

        // Assert
        Assert.Contains("find_users", tools);
        Assert.DoesNotContain(tools, t => t.Contains("token", StringComparison.Ordinal) || t.Contains("flag", StringComparison.Ordinal));
        var item = Assert.Single(Payload(found).GetProperty("items").EnumerateArray());
        Assert.Equal("target@ticketing.test", item.GetProperty("email").GetString());
        Assert.True(item.GetProperty("isActive").GetBoolean());
        Assert.True(hidden.IsError);
        Assert.Equal(ProjectErrors.NotFound, Payload(hidden).GetProperty("code").GetString());
    }

    private async Task<List<UserLookupDto>> Find(HttpClient client, string url) =>
        await (await client.GetAsync(url, _ct)).ReadAsync<List<UserLookupDto>>();

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
}
