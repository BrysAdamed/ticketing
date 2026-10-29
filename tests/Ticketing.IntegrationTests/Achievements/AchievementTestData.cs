using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Achievements;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Achievements;

[CollectionDefinition(nameof(AchievementsCollection))]
public sealed class AchievementsCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>Arrange and act helpers for achievements: the flag, the evaluator and the writes the criteria count.</summary>
internal static class AchievementTestData
{
    public static async Task<IReadOnlyList<AchievementProgress>> EvaluateAsync(
        this TicketingApiFactory api, IReadOnlyCollection<AchievementSubject> subjects, IReadOnlyCollection<string>? achievementIds = null)
    {
        await using var scope = api.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<AchievementEvaluator>()
            .EvaluateAsync(subjects, achievementIds, TestContext.Current.CancellationToken);
    }

    /// <summary>The count of <paramref name="achievementId"/> for <paramref name="user"/> counting from <paramref name="start"/>.</summary>
    public static async Task<int> CountAsync(this TicketingApiFactory api, TestUser user, DateTimeOffset start, string achievementId) =>
        (await api.EvaluateAsync([new AchievementSubject(user.Id, start)], [achievementId])).Single().Count;

    /// <summary>Creates the <c>achievements</c> flag, on for the given users only, or off when none are given.</summary>
    public static Task SetAchievementsFlagAsync(this TicketingApiFactory api, params TestUser[] users) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var flag = await db.FeatureFlags.SingleOrDefaultAsync(f => f.Key == AchievementsFeature.FlagKey);
            if (flag is null)
            {
                flag = FeatureFlag.Create(AchievementsFeature.FlagKey, "Achievements", null, now);
                db.FeatureFlags.Add(flag);
            }
            flag.Configure(flag.Description, users.Length > 0, 0, users.Select(u => u.Id), [], null, now);
            await db.SaveChangesAsync();
            api.Services.GetRequiredService<IFeatureFlagStore>().Invalidate();
            return true;
        });

    public static async Task<Guid> IdAsync(this HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.Created) =>
        (await response.ReadAsync<JsonElement>(expected)).GetProperty("id").GetGuid();

    public static Task<HttpResponseMessage> DeleteTicketAsync(this HttpClient client, string key) => client.DeleteAsync($"/api/v1/tickets/{key}");

    /// <summary>Archives and deletes a project as a fresh Admin (deletion is Admin-only and needs an archived project).</summary>
    public static async Task DeleteProjectAsync(this TicketingApiFactory api, string key)
    {
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        (await admin.PostAsync($"/api/v1/projects/{key}/archive", null)).EnsureSuccessStatusCode();
        await (await admin.DeleteAsync($"/api/v1/projects/{key}?confirmKey={key}")).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
    }

    public static Task<HttpResponseMessage> LinkAsync(this HttpClient client, string sourceKey, string targetKey, string type = "RelatesTo") =>
        client.PostAsJsonAsync($"/api/v1/tickets/{sourceKey}/links", new { targetKey, type }, HttpAssertions.Json);

    public static async Task<JsonElement> CallOkAsync(this McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: TestContext.Current.CancellationToken);
        Assert.False(result.IsError == true, $"{tool} failed: {(result.Content.FirstOrDefault() as TextContentBlock)?.Text}");
        return JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }
}
