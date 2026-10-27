using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Agents;
using Ticketing.Application.Common;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Agents;

/// <summary><c>GET/PATCH /projects/{pk}/agent</c> and the agent setup in the project DTO (spec 13.3, TKT-28).</summary>
[Collection(nameof(AgentsCollection))]
public sealed class ProjectAgentSettingsTests(TicketingApiFactory api)
{
    private const string Setup = "/api/v1/projects/TKT/agent";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task With_the_flag_off_the_setup_is_agent_disabled_and_missing_from_the_project()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var targeted = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT", members: (targeted, ProjectRole.Owner));
        await api.EnableAgentFlagAsync(targeted);
        var client = await api.LoginAsync(owner);
        var pat = await api.CreatePatClientAsync(owner);

        // Act
        var get = await client.GetAsync(Setup, _ct);
        var patch = await client.PatchAsJsonAsync(Setup, new { enabled = false }, _ct);
        var withPat = await pat.GetAsync(Setup, _ct);
        var project = await (await client.GetAsync("/api/v1/projects/TKT", _ct)).ReadAsync<JsonElement>();
        var forTargeted = await (await (await api.LoginAsync(targeted)).GetAsync("/api/v1/projects/TKT", _ct)).ReadAsync<JsonElement>();

        // Assert
        await get.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
        await patch.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
        await withPat.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
        Assert.Equal(JsonValueKind.Null, project.GetProperty("agent").ValueKind);
        Assert.True(forTargeted.GetProperty("agent").GetProperty("enabled").GetBoolean());
    }

    [Fact]
    public async Task A_new_project_reads_the_default_setup_with_its_row_version()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);
        var created = await (await client.PostAsJsonAsync("/api/v1/projects", new { key = "TKT", name = "Ticketing" }, _ct)).ReadAsync<JsonElement>(HttpStatusCode.Created);

        // Act
        var response = await client.GetAsync(Setup, _ct);
        var settings = await response.ReadAsync<ProjectAgentSettingsDto>();

        // Assert
        Assert.Equal(new ProjectAgentSettingsDto(false, null, null, "main", AgentMergePolicy.Review, true, true, settings.RowVersion), settings);
        Assert.Equal(created.GetProperty("rowVersion").GetUInt32(), settings.RowVersion);
        Assert.Equal($"\"{settings.RowVersion}\"", response.Headers.ETag?.Tag);
        Assert.False(created.GetProperty("agent").GetProperty("enabled").GetBoolean());
    }

    [Fact]
    public async Task An_owner_sets_up_delegation_and_each_changed_field_writes_one_activity_entry()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT", delegation: false);
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);
        var before = await api.WithDbAsync(db => db.ActivityEntries.CountAsync(_ct));

        // Act
        var settings = await (await client.PatchAsJsonAsync(Setup, new
        {
            enabled = true,
            repositoryUrl = "git@Git.Example.com:team/ticketing.git",
            defaultBranch = "develop",
            mergePolicy = "MergeWhenVerified",
            assignOnDelegate = false,
            startProgressOnDelegate = true,
        }, _ct)).ReadAsync<ProjectAgentSettingsDto>();
        var project = await (await client.GetAsync("/api/v1/projects/TKT", _ct)).ReadAsync<JsonElement>();
        var entries = await api.WithDbAsync(db => db.ActivityEntries
            .Where(a => a.Action == UpdateProjectAgentSettings.ChangedAction)
            .OrderBy(a => a.Field)
            .Select(a => new { a.Field, a.OldValue, a.NewValue })
            .ToListAsync(_ct));

        // Assert
        Assert.Equal(
            new ProjectAgentSettingsDto(true, "git@Git.Example.com:team/ticketing.git", "git.example.com/team/ticketing", "develop", AgentMergePolicy.MergeWhenVerified, false, true, settings.RowVersion),
            settings);
        var agent = project.GetProperty("agent");
        Assert.Equal("git.example.com/team/ticketing", agent.GetProperty("normalizedRepositoryUrl").GetString());
        Assert.Equal("MergeWhenVerified", agent.GetProperty("mergePolicy").GetString());
        Assert.Equal(project.GetProperty("rowVersion").GetUInt32(), settings.RowVersion);
        Assert.Equal(["agentAssignOnDelegate", "agentDelegationEnabled", "agentMergePolicy", "defaultBranch", "repositoryUrl"], entries.Select(e => e.Field));
        Assert.Equal(before + 5, await api.WithDbAsync(db => db.ActivityEntries.CountAsync(_ct)));
    }

    [Fact]
    public async Task Omitted_fields_stay_unchanged_and_an_unchanged_value_writes_no_activity()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);

        // Act
        var settings = await (await client.PatchAsJsonAsync(Setup, new { defaultBranch = "release/2026.10", enabled = true }, _ct)).ReadAsync<ProjectAgentSettingsDto>();

        // Assert
        Assert.Equal((true, AgentTestData.RepositoryUrl, "release/2026.10", AgentMergePolicy.Review), (settings.Enabled, settings.RepositoryUrl, settings.DefaultBranch, settings.MergePolicy));
        Assert.Equal(1, await api.WithDbAsync(db => db.ActivityEntries.CountAsync(a => a.Action == UpdateProjectAgentSettings.ChangedAction, _ct)));
    }

    [Fact]
    public async Task Enabling_a_project_without_a_repository_url_is_agent_project_repository_required()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);
        await (await client.PostAsJsonAsync("/api/v1/projects", new { key = "TKT", name = "Ticketing" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var response = await client.PatchAsJsonAsync(Setup, new { enabled = true, defaultBranch = "develop" }, _ct);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AgentErrors.RepositoryRequired);
        Assert.True(problem.GetProperty("errors").TryGetProperty("enabled", out _));
        var stored = await api.WithDbAsync(db => db.Projects.Select(p => new { p.DefaultBranch, p.AgentDelegationEnabled }).SingleAsync(_ct));
        Assert.Equal(("main", false), (stored.DefaultBranch, stored.AgentDelegationEnabled));
    }

    [Theory]
    [InlineData("""{ "repositoryUrl": null }""", AgentErrors.RepositoryRequired)]
    [InlineData("""{ "repositoryUrl": "  " }""", AgentErrors.RepositoryRequired)]
    [InlineData("""{ "repositoryUrl": "https://user:token@git.example.com/team/ticketing.git" }""", ProjectErrors.RepositoryUrlInvalid)]
    [InlineData("""{ "repositoryUrl": "C:\\src\\ticketing" }""", ProjectErrors.RepositoryUrlInvalid)]
    [InlineData("""{ "repositoryUrl": "git.example.com/team/ticketing" }""", ProjectErrors.RepositoryUrlInvalid)]
    [InlineData("""{ "defaultBranch": "two words" }""", ProjectErrors.DefaultBranchInvalid)]
    [InlineData("""{ "defaultBranch": "" }""", ProjectErrors.DefaultBranchInvalid)]
    [InlineData("""{ "defaultBranch": "main.lock" }""", ProjectErrors.DefaultBranchInvalid)]
    public async Task Invalid_setups_of_an_enabled_project_are_refused_and_change_nothing(string body, string code)
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);

        // Act
        var response = await client.PatchAsync(Setup, new StringContent(body, System.Text.Encoding.UTF8, "application/json"), _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, code);
        var stored = await api.WithDbAsync(db => db.Projects.Select(p => new { p.AgentDelegationEnabled, p.RepositoryUrl, p.DefaultBranch }).SingleAsync(_ct));
        Assert.Equal((true, AgentTestData.RepositoryUrl, "main"), (stored.AgentDelegationEnabled, stored.RepositoryUrl, stored.DefaultBranch));
        Assert.Equal(0, await api.WithDbAsync(db => db.ActivityEntries.CountAsync(_ct)));
    }

    [Fact]
    public async Task A_stale_if_match_is_a_concurrency_conflict()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);
        var read = await (await client.GetAsync(Setup, _ct)).ReadAsync<ProjectAgentSettingsDto>();
        await (await client.PatchAsJsonAsync("/api/v1/projects/TKT", new { name = "Renamed" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var request = new HttpRequestMessage(HttpMethod.Patch, Setup) { Content = JsonContent.Create(new { defaultBranch = "develop" }) };
        request.Headers.IfMatch.ParseAdd($"\"{read.RowVersion}\"");
        var response = await client.SendAsync(request, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, AppErrors.ConcurrencyConflict);
    }

    [Theory]
    [InlineData(ProjectRole.Member)]
    [InlineData(ProjectRole.Viewer)]
    public async Task Members_and_viewers_read_the_setup_but_cannot_change_it(ProjectRole role)
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var user = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT", members: (user, role));
        await api.EnableAgentFlagAsync(owner, user);
        var client = await api.LoginAsync(user);

        // Act
        var read = await client.GetAsync(Setup, _ct);
        var write = await client.PatchAsJsonAsync(Setup, new { enabled = false }, _ct);

        // Assert
        await read.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await write.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
    }

    [Fact]
    public async Task An_admin_who_is_not_a_member_may_change_the_setup()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(admin);

        // Act
        var settings = await (await (await api.LoginAsync(admin)).PatchAsJsonAsync(Setup, new { mergePolicy = "MergeWhenVerified" }, _ct)).ReadAsync<ProjectAgentSettingsDto>();

        // Assert
        Assert.Equal(AgentMergePolicy.MergeWhenVerified, settings.MergePolicy);
    }

    [Theory]
    [InlineData(PatScope.ReadWrite, AppErrors.CookieSessionRequired)]
    [InlineData(PatScope.ReadOnly, AppErrors.ReadOnlyToken)]
    public async Task A_token_reads_the_setup_but_changing_it_needs_the_web_session(PatScope scope, string code)
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var pat = await api.CreatePatClientAsync(owner, scope);

        // Act
        var read = await pat.GetAsync(Setup, _ct);
        var write = await pat.PatchAsJsonAsync(Setup, new { mergePolicy = "MergeWhenVerified" }, _ct);

        // Assert
        await read.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await write.ShouldBeProblemAsync(HttpStatusCode.Forbidden, code);
        Assert.Equal(AgentMergePolicy.Review, await api.WithDbAsync(db => db.Projects.Select(p => p.AgentMergePolicy).SingleAsync(_ct)));
    }

    [Fact]
    public async Task An_outsider_of_a_private_project_gets_the_same_404_as_for_a_missing_project()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.ProjectAsync(owner, "PUB", ProjectVisibility.Public);
        await api.EnableAgentFlagAsync(owner, outsider);
        var client = await api.LoginAsync(outsider);

        // Act
        var read = await client.GetAsync(Setup, _ct);
        var write = await client.PatchAsJsonAsync(Setup, new { enabled = false }, _ct);
        var missing = await client.GetAsync("/api/v1/projects/NOPE/agent", _ct);
        var publicProject = await client.GetAsync("/api/v1/projects/PUB/agent", _ct);

        // Assert
        var hidden = await read.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        await write.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        var absent = await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        Assert.Equal(absent.GetProperty("type").GetString(), hidden.GetProperty("type").GetString());
        await publicProject.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task An_archived_project_is_read_only()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ArchiveAsync(await api.ProjectAsync(owner, "TKT"), owner);
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);

        // Act
        var read = await client.GetAsync(Setup, _ct);
        var write = await client.PatchAsJsonAsync(Setup, new { enabled = false }, _ct);

        // Assert
        await read.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await write.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
    }

    [Fact]
    public async Task The_default_branch_is_a_prompt_placeholder()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ticket = await api.TicketAsync(await api.ProjectAsync(owner, "TKT"), owner);
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);
        await (await client.PatchAsJsonAsync(Setup, new { defaultBranch = "develop" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await client.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = "Branch {{ticket.key}} off {{project.defaultBranch}}.", baseVersion = 0 }))
            .ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var resolved = await (await client.GetAsync($"/api/v1/tickets/{ticket}/agent-prompt", _ct)).ReadAsync<ResolvedAgentPromptDto>();

        // Assert
        Assert.StartsWith($"Branch {ticket} off develop.\n\n", resolved.Prompt, StringComparison.Ordinal);
    }
}
