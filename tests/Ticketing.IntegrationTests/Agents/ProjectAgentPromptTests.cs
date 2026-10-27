using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Agents;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Agents;

[Collection(nameof(AgentsCollection))]
public sealed class ProjectAgentPromptTests(TicketingApiFactory api)
{
    private const string Prompts = "/api/v1/projects/TKT/agent/prompts";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    public static TheoryData<string, string> Endpoints => new()
    {
        { "GET", Prompts },
        { "GET", $"{Prompts}/Bug" },
        { "PUT", $"{Prompts}/Bug" },
        { "POST", $"{Prompts}/Bug/reset" },
        { "GET", $"{Prompts}/Bug/versions" },
        { "GET", $"{Prompts}/Bug/versions/1" },
        { "POST", $"{Prompts}/Bug/versions/1/restore" },
        { "POST", $"{Prompts}/Bug/preview" },
        { "GET", "/api/v1/agent/prompt-placeholders" },
        { "GET", "/api/v1/projects/TKT/agent" },
        { "PATCH", "/api/v1/projects/TKT/agent" },
        { "GET", "/api/v1/tickets/TKT-1/agent-prompt" },
    };

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Every_endpoint_is_a_404_agent_disabled_while_the_flag_is_off_for_the_caller(string method, string path)
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var otherOwner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT", members: (otherOwner, ProjectRole.Owner));
        await api.EnableAgentFlagAsync(otherOwner);
        var client = await api.LoginAsync(owner);
        var pat = await api.CreatePatClientAsync(owner);

        // Act
        var response = await client.SendAsync(Request(method, path), _ct);
        var withPat = await pat.SendAsync(Request(method, path), _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
        await withPat.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
    }

    [Fact]
    public async Task A_targeted_caller_gets_the_five_types_inheriting_the_instance_defaults()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);

        // Act
        var list = await (await client.GetAsync(Prompts, _ct)).ReadAsync<List<ProjectAgentPromptSummaryDto>>();
        var placeholders = await (await client.GetAsync("/api/v1/agent/prompt-placeholders", _ct)).ReadAsync<List<AgentPromptPlaceholder>>();

        // Assert
        Assert.Equal(["Epic", "UserStory", "Technical", "Spike", "Bug"], list.Select(p => p.Type.ToString()));
        Assert.All(list, p => Assert.Equal((AgentPromptMode.Inherit, 0, AgentPromptSource.Default, 1), (p.Mode, p.Version, p.EffectiveSource!.Value, p.EffectiveVersion!.Value)));
        Assert.DoesNotContain(placeholders, p => p.Name.Contains("title", StringComparison.Ordinal) || p.Name.Contains("description", StringComparison.Ordinal));
    }

    [Fact]
    public async Task An_owner_customises_a_type_and_each_save_is_a_version_whose_activity_has_no_body()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);

        // Act
        var custom = await (await client.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = "Fix {{ticket.key}} the TKT way.", changeNote = "ours", baseVersion = 0 }))
            .ReadAsync<ProjectAgentPromptDto>();
        var off = await (await client.PutPromptAsync("TKT", "bug", new { mode = "Off", baseVersion = 1 })).ReadAsync<ProjectAgentPromptDto>();

        // Assert
        Assert.Equal((AgentPromptMode.Custom, 1, AgentPromptSource.Custom, "Fix {{ticket.key}} the TKT way."), (custom.Mode, custom.Version, custom.EffectiveSource!.Value, custom.EffectiveBody));
        Assert.Equal((owner.Id, 1), (custom.UpdatedBy!.Id, custom.BasedOnDefaultVersion!.Value));
        Assert.Equal((AgentPromptMode.Off, 2, (AgentPromptSource?)null, (string?)null), (off.Mode, off.Version, off.EffectiveSource, off.EffectiveBody));
        var entries = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.Action == AgentPromptDefaults.UpdatedAction).OrderBy(a => a.OccurredAt).ToListAsync(_ct));
        Assert.Equal(2, entries.Count);
        Assert.All(entries, e => Assert.Equal((ActivityEntityType.AgentPrompt, "Bug", owner.Id, WriteChannel.Web), (e.EntityType, e.Field!, e.ActorId!.Value, e.Channel!.Value)));
        Assert.Equal(((0, "Inherit"), (1, "Custom")), (VersionAndMode(entries[0].OldValue), VersionAndMode(entries[0].NewValue)));
        Assert.Equal(["mode", "version"], JsonDocument.Parse(entries[1].NewValue!).RootElement.EnumerateObject().Select(p => p.Name).Order());
        Assert.DoesNotContain(entries, e => (e.OldValue + e.NewValue).Contains("TKT way", StringComparison.Ordinal));
        Assert.NotNull(entries[0].ProjectId);
    }

    [Fact]
    public async Task A_stale_base_version_is_a_409_version_conflict()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);
        var first = await client.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = "A {{ticket.key}}", baseVersion = 1 });
        await (await client.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = "A {{ticket.key}}", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var stale = await client.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = "B {{ticket.key}}", baseVersion = 0 });

        // Assert
        await first.ShouldBeProblemAsync(HttpStatusCode.Conflict, AgentErrors.VersionConflict);
        await stale.ShouldBeProblemAsync(HttpStatusCode.Conflict, AgentErrors.VersionConflict);
        Assert.Equal(1, await api.WithDbAsync(db => db.AgentPromptTemplateVersions.CountAsync(v => db.AgentPromptTemplates.Any(t => t.Id == v.TemplateId && t.ProjectId != null), _ct)));
    }

    [Theory]
    [InlineData("Fix it.\nRead {{ticket.title}} first.", AgentErrors.UnknownPlaceholder, "Line 2, column 6")]
    [InlineData("{{#if project.repositoryUrl}}clone", AgentErrors.UnbalancedIf, "Line 1, column 1")]
    [InlineData("  ", AgentErrors.TemplateEmpty, "body")]
    public async Task Invalid_templates_are_rejected_with_line_and_column(string body, string code, string message)
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);

        // Act
        var response = await client.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body, baseVersion = 0 });

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, code);
        Assert.Contains(message, problem.GetProperty("errors").GetProperty("body")[0].GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_custom_prompt_that_is_too_long_with_the_guardrails_is_rejected()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);

        // Act
        var response = await client.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = new string('x', 4_000), baseVersion = 0 });

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AgentErrors.PromptTooLong);
        Assert.Equal(0, await api.PromptActivityCountAsync());
    }

    [Fact]
    public async Task Versions_restore_and_reset_to_default_keep_the_whole_history()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);
        await (await client.PutPromptAsync("TKT", "Spike", new { mode = "Custom", body = "First {{ticket.key}}", changeNote = "v1", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await client.PutPromptAsync("TKT", "Spike", new { mode = "Custom", body = "Second {{ticket.key}}", baseVersion = 1 })).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var reset = await (await client.PostAsJsonAsync($"{Prompts}/Spike/reset", new { baseVersion = 2 }, _ct)).ReadAsync<ProjectAgentPromptDto>();
        var restored = await (await client.PostAsJsonAsync($"{Prompts}/Spike/versions/1/restore", new { baseVersion = 3, changeNote = "back to v1" }, _ct))
            .ReadAsync<AgentPromptVersionDto>();
        var versions = await (await client.GetAsync($"{Prompts}/Spike/versions", _ct)).ReadAsync<List<AgentPromptVersionSummaryDto>>();
        var second = await (await client.GetAsync($"{Prompts}/Spike/versions/2", _ct)).ReadAsync<AgentPromptVersionDto>();
        var missing = await client.GetAsync($"{Prompts}/Spike/versions/9", _ct);
        var current = await (await client.GetAsync($"{Prompts}/Spike", _ct)).ReadAsync<ProjectAgentPromptDto>();

        // Assert
        Assert.Equal((AgentPromptMode.Inherit, 3, AgentPromptSource.Default), (reset.Mode, reset.Version, reset.EffectiveSource!.Value));
        Assert.Equal((4, AgentPromptMode.Custom, "First {{ticket.key}}", (int?)1), (restored.Number, restored.Mode, restored.Body, restored.RestoredFrom));
        Assert.Equal([4, 3, 2, 1], versions.Select(v => v.Number));
        Assert.Equal([AgentPromptMode.Custom, AgentPromptMode.Inherit, AgentPromptMode.Custom, AgentPromptMode.Custom], versions.Select(v => v.Mode));
        Assert.Equal("Second {{ticket.key}}", second.Body);
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.VersionNotFound);
        Assert.Equal((4, "First {{ticket.key}}"), (current.Version, current.EffectiveBody));
        Assert.Equal(4, await api.PromptActivityCountAsync());
    }

    [Fact]
    public async Task Resetting_a_type_that_already_inherits_changes_nothing()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);

        // Act
        var reset = await (await client.PostAsJsonAsync($"{Prompts}/Bug/reset", new { baseVersion = 0 }, _ct)).ReadAsync<ProjectAgentPromptDto>();

        // Assert
        Assert.Equal((AgentPromptMode.Inherit, 0), (reset.Mode, reset.Version));
        Assert.Equal(0, await api.PromptActivityCountAsync());
    }

    [Fact]
    public async Task Preview_renders_a_real_ticket_with_the_guardrails_and_stores_nothing()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var projectId = await api.ProjectAsync(owner, "TKT");
        var ticket = await api.TicketAsync(projectId, owner);
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);
        await (await client.GetAsync(Prompts, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var versionsBefore = await api.WithDbAsync(db => db.AgentPromptTemplateVersions.CountAsync(_ct));

        // Act
        var custom = await (await client.PostAsJsonAsync($"{Prompts}/Bug/preview", new { body = "Fix {{ticket.key}} ({{template.id}}) in {{project.repositoryUrl}}.", ticketKey = ticket }, _ct))
            .ReadAsync<AgentPromptPreviewDto>();
        var sample = await (await client.PostAsJsonAsync($"{Prompts}/Bug/preview", new { }, _ct)).ReadAsync<AgentPromptPreviewDto>();

        // Assert
        Assert.StartsWith($"Fix {ticket} (Bug v1 / C) in {AgentTestData.RepositoryUrl}.\n\n<delegation_rules>", custom.Prompt, StringComparison.Ordinal);
        Assert.Contains($"{TicketingApiFactory.PublicUrl}/tickets/{ticket}", custom.Prompt, StringComparison.Ordinal);
        Assert.Equal((custom.Prompt!.Length, AgentPrompt.LengthLimit, ticket), (custom.Length, custom.LengthLimit, custom.TicketKey));
        Assert.StartsWith("<delegation_rules>", custom.Prompt[custom.GuardrailsStart!.Value..], StringComparison.Ordinal);
        Assert.Empty(custom.Errors);
        Assert.Equal("TKT-1234", sample.TicketKey);
        Assert.StartsWith("Fix the bug TKT-1234.", sample.Prompt, StringComparison.Ordinal);
        Assert.Equal(versionsBefore, await api.WithDbAsync(db => db.AgentPromptTemplateVersions.CountAsync(_ct)));
        Assert.Equal(0, await api.PromptActivityCountAsync());
    }

    [Fact]
    public async Task Preview_reports_template_errors_with_positions_and_the_length_limit()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);

        // Act
        var invalid = await (await client.PostAsJsonAsync($"{Prompts}/Bug/preview", new { body = "ok\n  {{ticket.description}}\n{{/if}}" }, _ct)).ReadAsync<AgentPromptPreviewDto>();
        var tooLong = await (await client.PostAsJsonAsync($"{Prompts}/Bug/preview", new { body = new string('x', 4_400) }, _ct)).ReadAsync<AgentPromptPreviewDto>();

        // Assert
        Assert.Null(invalid.Prompt);
        Assert.Equal(
            [(AgentErrors.UnknownPlaceholder, 2, 3), (AgentErrors.UnbalancedIf, 3, 1)],
            invalid.Errors.Select(e => (e.Code, e.Line!.Value, e.Column!.Value)));
        Assert.Equal(AgentErrors.PromptTooLong, Assert.Single(tooLong.Errors).Code);
        Assert.True(tooLong.Length >= AgentPrompt.LengthLimit);
    }

    [Fact]
    public async Task Preview_with_a_ticket_outside_the_project_is_a_404()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        var otherProject = await api.ProjectAsync(owner, "OTHER");
        var foreign = await api.TicketAsync(otherProject, owner);
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);

        // Act
        var response = await client.PostAsJsonAsync($"{Prompts}/Bug/preview", new { ticketKey = foreign }, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, "ticket.notFound");
    }

    [Fact]
    public async Task Members_and_viewers_read_while_owners_and_admins_write()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.ProjectAsync(owner, "TKT", members: [(member, ProjectRole.Member), (viewer, ProjectRole.Viewer)]);
        await api.EnableAgentFlagAsync(owner, member, viewer, admin);
        var body = new { mode = "Off", baseVersion = 0 };

        // Act
        var memberRead = await (await api.LoginAsync(member)).GetAsync($"{Prompts}/Bug", _ct);
        var viewerRead = await (await api.LoginAsync(viewer)).GetAsync($"{Prompts}/Bug/versions", _ct);
        var memberWrite = await (await api.LoginAsync(member)).PutPromptAsync("TKT", "Bug", body);
        var viewerWrite = await (await api.LoginAsync(viewer)).PutPromptAsync("TKT", "Bug", body);
        var adminWrite = await (await api.LoginAsync(admin)).PutPromptAsync("TKT", "Bug", body);

        // Assert
        await memberRead.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await viewerRead.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await memberWrite.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await viewerWrite.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        Assert.Equal(AgentPromptMode.Off, (await adminWrite.ReadAsync<ProjectAgentPromptDto>()).Mode);
    }

    [Fact]
    public async Task Template_writes_with_a_personal_access_token_are_refused_while_reads_work()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner);
        var readWrite = await api.CreatePatClientAsync(owner);
        var readOnly = await api.CreatePatClientAsync(owner, PatScope.ReadOnly);

        // Act
        var put = await readWrite.PutPromptAsync("TKT", "Bug", new { mode = "Off", baseVersion = 0 });
        var reset = await readWrite.PostAsJsonAsync($"{Prompts}/Bug/reset", new { baseVersion = 0 }, _ct);
        var restore = await readWrite.PostAsJsonAsync($"{Prompts}/Bug/versions/1/restore", new { baseVersion = 0 }, _ct);
        var preview = await readWrite.PostAsJsonAsync($"{Prompts}/Bug/preview", new { }, _ct);
        var readOnlyPut = await readOnly.PutPromptAsync("TKT", "Bug", new { mode = "Off", baseVersion = 0 });
        var read = await readOnly.GetAsync($"{Prompts}/Bug", _ct);

        // Assert
        await put.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
        await reset.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
        await restore.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
        await preview.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
        await readOnlyPut.ShouldHaveStatusAsync(HttpStatusCode.Forbidden);
        await read.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(0, await api.PromptActivityCountAsync());
    }

    [Fact]
    public async Task An_archived_project_is_read_only()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var projectId = await api.ProjectAsync(owner, "TKT");
        await api.ArchiveAsync(projectId, owner);
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);

        // Act
        var write = await client.PutPromptAsync("TKT", "Bug", new { mode = "Off", baseVersion = 0 });
        var read = await client.GetAsync(Prompts, _ct);

        // Assert
        await write.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
        await read.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_custom_prompt_shows_when_the_instance_default_changed_after_it_was_written()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.ProjectAsync(owner, "TKT");
        await api.EnableAgentFlagAsync(owner, admin);
        var client = await api.LoginAsync(owner);
        await (await client.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = "Ours {{ticket.key}}", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        await (await (await api.LoginAsync(admin)).PutInstancePromptAsync("Bug", new { body = "New default {{ticket.key}}", baseVersion = 1 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var list = await (await client.GetAsync(Prompts, _ct)).ReadAsync<List<ProjectAgentPromptSummaryDto>>();
        var bug = await (await client.GetAsync($"{Prompts}/Bug", _ct)).ReadAsync<ProjectAgentPromptDto>();

        // Assert
        var summary = list.Single(p => p.Type == TicketType.Bug);
        Assert.Equal((true, 2), (summary.DefaultChanged, summary.DefaultVersion));
        Assert.Equal((1, "New default {{ticket.key}}", true), (bug.BasedOnDefaultVersion!.Value, bug.DefaultBody, bug.DefaultChanged));
        Assert.False(list.Single(p => p.Type == TicketType.Epic).DefaultChanged);
    }

    private static (int Version, string? Mode) VersionAndMode(string? json)
    {
        var value = JsonDocument.Parse(json!).RootElement;
        return (value.GetProperty("version").GetInt32(), value.GetProperty("mode").GetString());
    }

    private static HttpRequestMessage Request(string method, string path) =>
        new(new HttpMethod(method), path) { Content = method == "GET" ? null : JsonContent.Create(new { mode = "Off", body = "x", baseVersion = 0 }) };
}
