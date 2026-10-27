using System.Net;
using Microsoft.Extensions.Options;
using Ticketing.Application.Agents;
using Ticketing.Application.Common;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Agents;

[Collection(nameof(AgentsCollection))]
public sealed class AgentInstanceStatusTests(TicketingApiFactory api)
{
    private const string Status = "/api/v1/admin/agent/status";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task With_the_flag_off_the_status_is_a_404_agent_disabled()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var client = await api.LoginAsync(admin);

        // Act
        var response = await client.GetAsync(Status, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
    }

    [Fact]
    public async Task An_admin_sees_the_configured_public_url()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync(admin);
        var client = await api.LoginAsync(admin);

        // Act
        var status = await (await client.GetAsync(Status, _ct)).ReadAsync<AgentInstanceStatusDto>();

        // Assert
        Assert.Equal(new AgentInstanceStatusDto(AgentOptions.PublicUrlVariable, TicketingApiFactory.PublicUrl, true), status);
    }

    [Fact]
    public async Task Without_a_public_url_only_the_status_answers_and_says_delegation_is_off()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync(admin);
        var client = await api.LoginAsync(admin);
        var options = api.Services.GetRequiredService<IOptions<AgentOptions>>().Value;
        var publicUrl = options.PublicUrl;
        options.PublicUrl = null;
        try
        {
            // Act
            var status = await (await client.GetAsync(Status, _ct)).ReadAsync<AgentInstanceStatusDto>();
            var prompts = await client.GetAsync("/api/v1/admin/agent/prompts", _ct);

            // Assert
            Assert.Equal(new AgentInstanceStatusDto(AgentOptions.PublicUrlVariable, null, false), status);
            await prompts.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
        }
        finally
        {
            options.PublicUrl = publicUrl;
        }
    }

    [Fact]
    public async Task Only_admins_in_the_web_app_see_the_status_and_never_the_url()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync([], GlobalRole.Admin, GlobalRole.User);
        var userClient = await api.LoginAsync(user);
        var userPat = await api.CreatePatClientAsync(user);
        var adminPat = await api.CreatePatClientAsync(admin);

        // Act
        var asUser = await userClient.GetAsync(Status, _ct);
        var asUserPat = await userPat.GetAsync(Status, _ct);
        var asAdminPat = await adminPat.GetAsync(Status, _ct);

        // Assert
        await asUser.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.Forbidden);
        await asUserPat.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.CookieSessionRequired);
        await asAdminPat.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.CookieSessionRequired);
        foreach (var response in new[] { asUser, asUserPat, asAdminPat })
            Assert.DoesNotContain(TicketingApiFactory.PublicUrl, await response.Content.ReadAsStringAsync(_ct), StringComparison.Ordinal);
    }
}
