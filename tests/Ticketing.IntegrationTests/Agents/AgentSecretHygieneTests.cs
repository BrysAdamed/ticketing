using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Agents;

/// <summary>
/// The secrets of agent delegation (threat model, docs/architecture/agent-delegation-threats.md): a prompt body, a local
/// folder and a personal access token never reach the API logs, activity values, notifications or error bodies.
/// </summary>
[Collection(nameof(AgentsCollection))]
public sealed class AgentSecretHygieneTests(TicketingApiFactory api)
{
    private const string Marker = "PROMPT-MARKER-7f3a";
    private const string LocalFolder = @"C:\Users\victim\secret-clone";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Prompts_folders_and_tokens_never_reach_logs_activity_notifications_or_error_bodies()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var project = await api.ProjectAsync(owner, "TKT", members: (member, ProjectRole.Member));
        var ticket = await api.TicketAsync(project, owner);
        await api.EnableAgentFlagAsync(owner, member);
        var ownerClient = await api.LoginAsync(owner);
        var memberClient = await api.LoginAsync(member);
        var pat = await api.CreatePatAsync(member);
        await using var mcp = await api.CreateMcpClientAsync(pat);
        var body = $"Fix {{{{ticket.key}}}}. {Marker}";

        // Act
        var saved = await ownerClient.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body, baseVersion = 0 });
        var unknownPlaceholder = await ownerClient.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = $"{Marker} {{{{ticket.title}}}}", baseVersion = 1 });
        var tooLong = await ownerClient.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = Marker + new string('x', 5000), baseVersion = 1 });
        var stale = await ownerClient.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = $"{body} again", baseVersion = 0 });
        var withToken = await api.CreateBearerClient(pat).PutPromptAsync("TKT", "Bug", new { mode = "Custom", body, baseVersion = 1 });
        var malformed = await ownerClient.PutAsync(
            "/api/v1/projects/TKT/agent/prompts/Bug", new StringContent($"{{\"mode\":\"Custom\",\"body\":\"{Marker}", System.Text.Encoding.UTF8, "application/json"), _ct);
        await ownerClient.PostAsJsonAsync("/api/v1/projects/TKT/agent/prompts/Bug/preview", new { body = $"{Marker} {{{{nope}}}}" }, _ct);
        var resolved = await memberClient.GetAsync($"/api/v1/tickets/{ticket}/agent-prompt", _ct);
        var overMcp = await mcp.CallToolAsync("get_agent_prompt", new Dictionary<string, object?> { ["key"] = ticket }, cancellationToken: _ct);
        var delegated = await memberClient.PostAsJsonAsync(
            $"/api/v1/tickets/{ticket}/agent-delegations", new { app = "ClaudeCode", folder = LocalFolder, prompt = Marker }, _ct);
        var wrongToken = await api.CreateBearerClient(pat + "x").GetAsync($"/api/v1/tickets/{ticket}/agent-prompt", _ct);

        // Assert
        await saved.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Contains(Marker, (await resolved.ReadAsync<JsonElement>()).GetProperty("prompt").GetString(), StringComparison.Ordinal);
        Assert.NotEqual(true, overMcp.IsError);
        await delegated.ShouldHaveStatusAsync(HttpStatusCode.OK);
        foreach (var failed in new[] { unknownPlaceholder, tooLong, stale, withToken, malformed, wrongToken })
        {
            Assert.False(failed.IsSuccessStatusCode);
            var problem = await failed.Content.ReadAsStringAsync(_ct);
            Assert.DoesNotContain(Marker, problem, StringComparison.Ordinal);
            Assert.DoesNotContain(pat, problem, StringComparison.Ordinal);
        }

        var stored = await api.WithDbAsync(async db =>
            (await db.ActivityEntries.AsNoTracking().Select(a => new { a.OldValue, a.NewValue }).ToListAsync(_ct))
            .Select(a => $"{a.OldValue} {a.NewValue}")
            .Concat(await db.Notifications.AsNoTracking().Select(n => n.Summary).ToListAsync(_ct))
            .ToList());
        Assert.NotEmpty(stored);
        Assert.DoesNotContain(stored, value => value.Contains(Marker, StringComparison.Ordinal) || value.Contains("secret-clone", StringComparison.Ordinal));

        Assert.NotEmpty(api.Logs.Lines);
        Assert.DoesNotContain(api.Logs.Lines, line =>
            line.Contains(Marker, StringComparison.Ordinal) || line.Contains("secret-clone", StringComparison.Ordinal) || line.Contains(pat, StringComparison.Ordinal));
    }
}
