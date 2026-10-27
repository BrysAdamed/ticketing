using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Agents;
using Ticketing.Application.Common;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Agents;

[Collection(nameof(AgentsCollection))]
public sealed class InstanceAgentPromptTests(TicketingApiFactory api)
{
    private const string Prompts = "/api/v1/admin/agent/prompts";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    public static TheoryData<string, string> Endpoints => new()
    {
        { "GET", Prompts },
        { "GET", $"{Prompts}/Bug" },
        { "PUT", $"{Prompts}/guardrails" },
        { "POST", $"{Prompts}/Bug/reset-built-in" },
        { "GET", $"{Prompts}/Bug/versions" },
        { "GET", $"{Prompts}/Bug/versions/1" },
        { "POST", $"{Prompts}/Bug/versions/1/restore" },
        { "POST", $"{Prompts}/guardrails/preview" },
        { "GET", $"{Prompts}/Bug/overrides" },
    };

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Every_admin_endpoint_is_a_404_agent_disabled_while_the_flag_is_off(string method, string path)
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var client = await api.LoginAsync(admin);

        // Act
        var response = await client.SendAsync(Request(method, path), _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Instance_prompts_are_for_admins_in_the_web_app_only(string method, string path)
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync([], GlobalRole.Admin, GlobalRole.User);
        var userClient = await api.LoginAsync(user);
        var adminPat = await api.CreatePatClientAsync(admin);

        // Act
        var asUser = await userClient.SendAsync(Request(method, path), _ct);
        var withPat = await adminPat.SendAsync(Request(method, path), _ct);

        // Assert
        await asUser.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.Forbidden);
        await withPat.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.CookieSessionRequired);
    }

    [Fact]
    public async Task The_six_slots_start_as_the_built_ins()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync([], GlobalRole.Admin);
        var client = await api.LoginAsync(admin);

        // Act
        var list = await (await client.GetAsync(Prompts, _ct)).ReadAsync<List<InstanceAgentPromptSummaryDto>>();
        var guardrails = await (await client.GetAsync($"{Prompts}/GUARDRAILS", _ct)).ReadAsync<InstanceAgentPromptDto>();
        var unknown = await client.GetAsync($"{Prompts}/Story", _ct);

        // Assert
        Assert.Equal(["Epic", "UserStory", "Technical", "Spike", "Bug", "Guardrails"], list.Select(p => p.Slot));
        Assert.All(list, p => Assert.Equal((1, EmbeddedAgentPrompts.Release, true, false), (p.Version, p.BuiltInVersion!, p.FollowsBuiltIn, p.NewerBuiltInAvailable)));
        Assert.All(list, p => Assert.Null(p.UpdatedBy));
        Assert.Equal(guardrails.BuiltInBody, guardrails.Body);
        Assert.StartsWith("<delegation_rules>", guardrails.Body, StringComparison.Ordinal);
        await unknown.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.PromptNotFound);
    }

    [Fact]
    public async Task Editing_stops_following_the_built_in_and_reset_adopts_it_again()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync([], GlobalRole.Admin);
        var client = await api.LoginAsync(admin);

        // Act
        var edited = await (await client.PutInstancePromptAsync("Technical", new { body = "Our technical prompt for {{ticket.key}}.", changeNote = "house", baseVersion = 1 }))
            .ReadAsync<InstanceAgentPromptDto>();
        var stale = await client.PutInstancePromptAsync("Technical", new { body = "Again {{ticket.key}}", baseVersion = 1 });
        var reset = await (await client.PostAsJsonAsync($"{Prompts}/Technical/reset-built-in", new { baseVersion = 2 }, _ct)).ReadAsync<InstanceAgentPromptDto>();
        var restored = await (await client.PostAsJsonAsync($"{Prompts}/Technical/versions/2/restore", new { baseVersion = 3 }, _ct)).ReadAsync<AgentPromptVersionDto>();
        var versions = await (await client.GetAsync($"{Prompts}/Technical/versions", _ct)).ReadAsync<List<AgentPromptVersionSummaryDto>>();
        var current = await (await client.GetAsync($"{Prompts}/Technical", _ct)).ReadAsync<InstanceAgentPromptDto>();

        // Assert
        Assert.Equal((2, false, admin.Id), (edited.Version, edited.FollowsBuiltIn, edited.UpdatedBy!.Id));
        await stale.ShouldBeProblemAsync(HttpStatusCode.Conflict, AgentErrors.VersionConflict);
        Assert.Equal((3, true, reset.BuiltInBody), (reset.Version, reset.FollowsBuiltIn, reset.Body!));
        Assert.Equal((4, "Our technical prompt for {{ticket.key}}.", (int?)2), (restored.Number, restored.Body, restored.RestoredFrom));
        Assert.Equal([(4, null), (3, EmbeddedAgentPrompts.Release), (2, null), (1, EmbeddedAgentPrompts.Release)], versions.Select(v => (v.Number, v.BuiltInVersion)));
        Assert.Equal(("house", (Guid?)null), (versions[2].ChangeNote, versions[3].Author?.Id));
        Assert.False(current.FollowsBuiltIn);
    }

    [Fact]
    public async Task The_guardrails_can_be_removed_but_not_grow_past_the_limit_of_any_default()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync([], GlobalRole.Admin);
        var client = await api.LoginAsync(admin);

        // Act
        var tooLong = await client.PutInstancePromptAsync("guardrails", new { body = new string('r', 3_500), baseVersion = 1 });
        var typeTooLong = await client.PutInstancePromptAsync("Bug", new { body = "{{ticket.key}}" + new string('b', 4_000), baseVersion = 1 });
        var cleared = await (await client.PutInstancePromptAsync("guardrails", new { body = "", baseVersion = 1 })).ReadAsync<InstanceAgentPromptDto>();
        var fitsWithoutGuardrails = await client.PutInstancePromptAsync("Bug", new { body = "{{ticket.key}}" + new string('b', 4_000), baseVersion = 1 });

        // Assert
        Assert.Equal((2, (string?)null), (cleared.Version, cleared.Body));
        var problem = await tooLong.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AgentErrors.PromptTooLong);
        Assert.Contains("default)", problem.GetProperty("errors").GetProperty("body")[0].GetString(), StringComparison.Ordinal);
        await typeTooLong.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AgentErrors.PromptTooLong);
        await fitsWithoutGuardrails.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Preview_of_the_guardrails_renders_them_after_a_sample_default_and_stores_nothing()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync([], GlobalRole.Admin);
        var client = await api.LoginAsync(admin);

        // Act
        var preview = await (await client.PostAsJsonAsync($"{Prompts}/guardrails/preview", new { body = "Rules for {{ticket.key}} at {{instance.url}}." }, _ct))
            .ReadAsync<AgentPromptPreviewDto>();

        // Assert
        Assert.StartsWith("Deliver the user story PROJECT-1234.", preview.Prompt, StringComparison.Ordinal);
        Assert.EndsWith($"\n\nRules for PROJECT-1234 at {TicketingApiFactory.PublicUrl}.", preview.Prompt, StringComparison.Ordinal);
        Assert.Equal(0, await api.PromptActivityCountAsync());
    }

    [Fact]
    public async Task Each_type_counts_the_live_projects_that_override_it()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync([], GlobalRole.Admin);
        var client = await api.LoginAsync(admin);
        foreach (var key in new[] { "ONE", "TWO", "THREE", "GONE" })
            await api.ProjectAsync(admin, key);
        await (await client.PutPromptAsync("ONE", "Bug", new { mode = "Custom", body = "Ours {{ticket.key}}", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await client.PutPromptAsync("TWO", "Bug", new { mode = "Off", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await client.PutPromptAsync("THREE", "Bug", new { mode = "Off", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await client.PostAsJsonAsync("/api/v1/projects/THREE/agent/prompts/Bug/reset", new { baseVersion = 1 }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await client.PutPromptAsync("GONE", "Bug", new { mode = "Off", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await api.WithDbAsync(async db =>
        {
            var gone = await db.Projects.SingleAsync(p => p.Key == "GONE", _ct);
            gone.Archive(admin.Id, DateTimeOffset.UtcNow);
            gone.Delete(admin.Id, DateTimeOffset.UtcNow, "GONE");
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var list = await (await client.GetAsync(Prompts, _ct)).ReadAsync<List<InstanceAgentPromptSummaryDto>>();

        // Assert
        Assert.Equal(2, list.Single(p => p.Slot == "Bug").OverridingProjects);
        Assert.All(list.Where(p => p.Slot != "Bug"), p => Assert.Equal(0, p.OverridingProjects));
    }

    [Fact]
    public async Task The_overriding_projects_of_a_type_are_listed_by_key_with_their_mode()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var owner = await api.CreateUserAsync();
        await api.EnableAgentFlagAsync([], GlobalRole.Admin, GlobalRole.User);
        var adminClient = await api.LoginAsync(admin);
        var ownerClient = await api.LoginAsync(owner);
        await api.ProjectAsync(owner, "PRIV");
        var archived = await api.ProjectAsync(owner, "ARCH");
        await api.ProjectAsync(owner, "INHERIT");
        await api.ProjectAsync(owner, "GONE");
        await (await ownerClient.PutPromptAsync("PRIV", "Bug", new { mode = "Custom", body = "Private {{ticket.key}}", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await ownerClient.PutPromptAsync("ARCH", "Bug", new { mode = "Off", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await ownerClient.PutPromptAsync("INHERIT", "Bug", new { mode = "Off", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await ownerClient.PostAsJsonAsync("/api/v1/projects/INHERIT/agent/prompts/Bug/reset", new { baseVersion = 1 }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await ownerClient.PutPromptAsync("GONE", "Bug", new { mode = "Off", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await ownerClient.PutPromptAsync("PRIV", "Spike", new { mode = "Off", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await adminClient.PutInstancePromptAsync("Bug", new { body = "Newer default {{ticket.key}}", baseVersion = 1 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await api.ArchiveAsync(archived, owner);
        await api.WithDbAsync(async db =>
        {
            var gone = await db.Projects.SingleAsync(p => p.Key == "GONE", _ct);
            gone.Archive(owner.Id, DateTimeOffset.UtcNow);
            gone.Delete(owner.Id, DateTimeOffset.UtcNow, "GONE");
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var overrides = await (await adminClient.GetAsync($"{Prompts}/bug/overrides", _ct)).ReadAsync<List<AgentPromptOverrideDto>>();
        var count = (await (await adminClient.GetAsync(Prompts, _ct)).ReadAsync<List<InstanceAgentPromptSummaryDto>>()).Single(p => p.Slot == "Bug").OverridingProjects;
        var none = await (await adminClient.GetAsync($"{Prompts}/Epic/overrides", _ct)).ReadAsync<List<AgentPromptOverrideDto>>();
        var guardrails = await adminClient.GetAsync($"{Prompts}/guardrails/overrides", _ct);

        // Assert
        Assert.Equal(
            [("ARCH", true, AgentPromptMode.Off, false), ("PRIV", false, AgentPromptMode.Custom, true)],
            overrides.Select(o => (o.ProjectKey, o.IsArchived, o.Mode, o.DefaultChanged)));
        Assert.Equal(("PRIV project", 1, owner.Id), (overrides[1].ProjectName, overrides[1].Version, overrides[1].UpdatedBy!.Id));
        Assert.Equal(overrides.Count, count);
        Assert.Empty(none);
        await guardrails.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.PromptNotFound);
    }

    [Fact]
    public async Task Preview_of_cleared_guardrails_shows_the_prompt_without_them()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync([], GlobalRole.Admin);
        var client = await api.LoginAsync(admin);

        // Act
        var stored = await (await client.PostAsJsonAsync($"{Prompts}/guardrails/preview", new { body = (string?)null }, _ct)).ReadAsync<AgentPromptPreviewDto>();
        var cleared = await (await client.PostAsJsonAsync($"{Prompts}/guardrails/preview", new { body = "" }, _ct)).ReadAsync<AgentPromptPreviewDto>();

        // Assert
        Assert.NotNull(stored.GuardrailsStart);
        Assert.Null(cleared.GuardrailsStart);
        Assert.Equal(stored.Prompt![..stored.GuardrailsStart!.Value].TrimEnd(), cleared.Prompt);
    }

    [Fact]
    public async Task Prompt_changes_appear_in_the_admin_audit_trail_without_the_body()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync([], GlobalRole.Admin);
        await api.ProjectAsync(admin, "TKT");
        var client = await api.LoginAsync(admin);
        await (await client.PutInstancePromptAsync("guardrails", new { body = "Secret-free rules.", baseVersion = 1 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await client.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = "Ours {{ticket.key}}", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var audit = await (await client.GetAsync("/api/v1/admin/audit?entityType=AgentPrompt", _ct)).ReadAsync<JsonElement>();

        // Assert
        var items = audit.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(["TKT Bug", "Guardrails"], items.Select(i => i.GetProperty("entityLabel").GetString()));
        Assert.All(items, i => Assert.Equal(AgentPromptDefaults.UpdatedAction, i.GetProperty("action").GetString()));
        Assert.DoesNotContain("rules", audit.GetRawText(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_newer_built_in_upgrades_unedited_slots_and_is_offered_to_edited_ones()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync([], GlobalRole.Admin);
        var client = await api.LoginAsync(admin);
        await (await client.PutInstancePromptAsync("Bug", new { body = "Our bug prompt {{ticket.key}}.", baseVersion = 1 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var next = new NextRelease();

        // Act
        await using (var scope = api.Services.CreateAsyncScope())
        {
            var defaults = new AgentPromptDefaults(
                scope.ServiceProvider.GetRequiredService<ITicketingDbContext>(), next, scope.ServiceProvider.GetRequiredService<IClock>());
            await defaults.EnsureAsync(_ct);
            await defaults.EnsureAsync(_ct);
        }
        var rows = await api.WithDbAsync(db => db.AgentPromptTemplates.AsNoTracking().Where(t => t.Scope == AgentPromptScope.Instance).ToListAsync(_ct));

        // Assert
        var bug = rows.Single(r => r.Slot.Type == TicketType.Bug);
        Assert.Equal((2, "Our bug prompt {{ticket.key}}.", false), (bug.CurrentVersion, bug.Body, bug.FollowsBuiltIn));
        Assert.True(bug.NewerBuiltInAvailable(next.For(bug.Slot)));
        Assert.All(rows.Where(r => r != bug), r => Assert.Equal((2, NextRelease.Release, next.For(r.Slot).Body), (r.CurrentVersion, r.BuiltInVersion!, r.Body!)));
        var upgrades = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.Action == AgentPromptDefaults.UpdatedAction && a.ActorId == null).CountAsync(_ct));
        Assert.Equal(5, upgrades);
    }

    private static HttpRequestMessage Request(string method, string path) =>
        new(new HttpMethod(method), path) { Content = method == "GET" ? null : JsonContent.Create(new { body = "x", baseVersion = 1 }) };

    /// <summary>A second built-in release, as a later version of the app would ship it.</summary>
    private sealed class NextRelease : IBuiltInAgentPrompts
    {
        public const string Release = "2099.1.1";

        public string Version => Release;

        public BuiltInPrompt For(AgentPromptSlot slot) => new(slot, Release, $"Release {Release} for {slot.Name}: {{{{ticket.key}}}}.");

        public string FinishSentence(AgentMergePolicy policy) => "Finish.";
    }
}
