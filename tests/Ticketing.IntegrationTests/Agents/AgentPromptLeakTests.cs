using System.Net;
using System.Net.Http.Json;
using Ticketing.Application.Agents;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Agents;

/// <summary>
/// The ReadableProjectsLeakGuardTests pattern for agent prompts: on every read path an Admin and a member see a private
/// project's prompts, an outsider gets the same 404 as for a project that does not exist, and a deleted project is gone for all.
/// </summary>
[Collection(nameof(AgentsCollection))]
public sealed class AgentPromptLeakTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    public static TheoryData<string, string> ReadPaths => new()
    {
        { "GET", "" },
        { "GET", "/Bug" },
        { "GET", "/Bug/versions" },
        { "GET", "/Bug/versions/1" },
        { "POST", "/Bug/preview" },
    };

    [Theory]
    [MemberData(nameof(ReadPaths))]
    public async Task Only_readers_of_a_private_project_see_its_prompts(string method, string path)
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.ProjectAsync(owner, "PRIV", members: (member, ProjectRole.Member));
        await api.ProjectAsync(owner, "GONE", ProjectVisibility.Public);
        await api.EnableAgentFlagAsync(owner, member, outsider, admin);
        var ownerClient = await api.LoginAsync(owner);
        foreach (var key in new[] { "PRIV", "GONE" })
            await (await ownerClient.PutPromptAsync(key, "Bug", new { mode = "Off", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await api.WithDbAsync(async db =>
        {
            var gone = db.Projects.Single(p => p.Key == "GONE");
            gone.Archive(owner.Id, DateTimeOffset.UtcNow);
            gone.Delete(owner.Id, DateTimeOffset.UtcNow, "GONE");
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var asAdmin = await SendAsync(await api.LoginAsync(admin), method, "PRIV", path);
        var asMember = await SendAsync(await api.LoginAsync(member), method, "PRIV", path);
        var asOutsider = await SendAsync(await api.LoginAsync(outsider), method, "PRIV", path);
        var missing = await SendAsync(await api.LoginAsync(outsider), method, "NOPE", path);
        var deletedForAdmin = await SendAsync(await api.LoginAsync(admin), method, "GONE", path);

        // Assert
        await asAdmin.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await asMember.ShouldHaveStatusAsync(HttpStatusCode.OK);
        var hidden = await asOutsider.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        var absent = await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        await deletedForAdmin.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        Assert.Equal(absent.GetProperty("type").GetString(), hidden.GetProperty("type").GetString());
    }

    public static TheoryData<string, string> WritePaths => new()
    {
        { "PUT", "/Bug" },
        { "POST", "/Bug/reset" },
        { "POST", "/Bug/versions/1/restore" },
    };

    [Theory]
    [MemberData(nameof(WritePaths))]
    public async Task Writes_to_a_private_projects_prompts_are_the_same_404_for_outsiders_as_for_a_missing_project(string method, string path)
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "PRIV");
        await api.EnableAgentFlagAsync(owner, outsider);
        await (await (await api.LoginAsync(owner)).PutPromptAsync("PRIV", "Bug", new { mode = "Off", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var client = await api.LoginAsync(outsider);
        var body = new { mode = "Inherit", baseVersion = 1 };

        // Act
        var hidden = await SendAsync(client, method, "PRIV", path, body);
        var missing = await SendAsync(client, method, "NOPE", path, body);

        // Assert
        var hiddenProblem = await hidden.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        var missingProblem = await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        Assert.Equal(missingProblem.GetProperty("type").GetString(), hiddenProblem.GetProperty("type").GetString());
        Assert.Equal(1, await api.PromptActivityCountAsync());
    }

    [Fact]
    public async Task Resolving_a_prompt_hides_private_tickets_from_outsiders()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var privateTicket = await api.TicketAsync(await api.ProjectAsync(owner, "PRIV"), owner);
        var publicTicket = await api.TicketAsync(await api.ProjectAsync(owner, "PUB", ProjectVisibility.Public), owner);
        await api.EnableAgentFlagAsync(owner, outsider, admin);

        // Act
        var hidden = await Assert.ThrowsAsync<AppException>(() => ResolveAsync(outsider, privateTicket));
        var visible = await ResolveAsync(outsider, publicTicket);
        var asAdmin = await ResolveAsync(admin, privateTicket);

        // Assert
        Assert.Equal((ErrorKind.NotFound, "ticket.notFound"), (hidden.Kind, hidden.Code));
        Assert.Equal(publicTicket, visible.TicketKey);
        Assert.Equal(privateTicket, asAdmin.TicketKey);
    }

    private async Task<HttpResponseMessage> SendAsync(HttpClient client, string method, string projectKey, string path, object? body = null)
    {
        var uri = $"/api/v1/projects/{projectKey}/agent/prompts{path}";
        return method switch
        {
            "GET" => await client.GetAsync(uri, _ct),
            "PUT" => await client.PutAsJsonAsync(uri, body ?? new { }, _ct),
            _ => await client.PostAsJsonAsync(uri, body ?? new { }, _ct),
        };
    }

    private Task<ResolvedAgentPromptDto> ResolveAsync(TestUser user, string ticketKey) =>
        api.ExecuteAsAsync(user, sp => sp.GetRequiredService<ResolveAgentPrompt.Handler>().HandleAsync(new ResolveAgentPrompt.Query(ticketKey), _ct));
}
