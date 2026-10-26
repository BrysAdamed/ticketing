using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Application.Projects;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Projects;

[Collection(nameof(ApiCollection))]
public sealed class ProjectEndpointTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Create_returns_201_with_the_creator_as_owner_and_records_activity()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/projects", new { key = "WEB", name = "  Website  ", description = "Our site" }, _ct);

        // Assert
        var project = await response.ReadAsync<ProjectDto>(HttpStatusCode.Created);
        Assert.Equal("/api/v1/projects/WEB", response.Headers.Location?.OriginalString);
        Assert.Equal(("WEB", "Website", ProjectVisibility.Private, ProjectRole.Owner), (project.Key, project.Name, project.Visibility, project.MyRole));
        Assert.Equal(user.Id, Assert.Single(project.Members).UserId);
        Assert.NotEqual(0u, project.Version);
        var activity = await api.WithDbAsync(db => db.ActivityEntries.SingleAsync(_ct));
        Assert.Equal(("project.created", user.Id, WriteChannel.Web), (activity.Action, activity.ActorId, activity.Channel));
    }

    [Fact]
    public async Task Create_reports_every_invalid_field()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/projects", new { key = "web-1", name = "" }, _ct);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.True(problem.GetProperty("errors").TryGetProperty("key", out _));
        Assert.True(problem.GetProperty("errors").TryGetProperty("name", out _));
    }

    [Fact]
    public async Task Create_rejects_a_taken_key_and_a_taken_name()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await (await client.PostAsJsonAsync("/api/v1/projects", new { key = "WEB", name = "Website" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var sameKey = await client.PostAsJsonAsync("/api/v1/projects", new { key = "WEB", name = "Other" }, _ct);
        var sameName = await client.PostAsJsonAsync("/api/v1/projects", new { key = "OTHER", name = "WEBSITE" }, _ct);

        // Assert
        await sameKey.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.KeyTaken);
        await sameName.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.NameTaken);
    }

    [Fact]
    public async Task Create_with_the_same_idempotency_key_returns_the_original_result()
    {
        // Arrange
        var client = await api.CreatePatClientAsync(await api.CreateUserAsync());
        HttpRequestMessage Request(string name) => new(HttpMethod.Post, "/api/v1/projects")
        {
            Content = JsonContent.Create(new { key = "IDEM", name }),
            Headers = { { "Idempotency-Key", "create-idem-1" } },
        };

        // Act
        var first = await (await client.SendAsync(Request("Idempotent"), _ct)).ReadAsync<ProjectDto>(HttpStatusCode.Created);
        var replay = await (await client.SendAsync(Request("Idempotent"), _ct)).ReadAsync<ProjectDto>(HttpStatusCode.Created);
        var reused = await client.SendAsync(Request("Different payload"), _ct);

        // Assert
        Assert.Equal(first.Id, replay.Id);
        await reused.ShouldBeProblemAsync(HttpStatusCode.Conflict, AppErrors.IdempotencyKeyReused);
        Assert.Equal(1, await api.WithDbAsync(db => db.Projects.CountAsync(_ct)));
    }

    [Fact]
    public async Task Get_by_key_is_case_insensitive_and_returns_the_version_as_etag()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        var created = await (await client.PostAsJsonAsync("/api/v1/projects", new { key = "WEB", name = "Website" }, _ct)).ReadAsync<ProjectDto>(HttpStatusCode.Created);

        // Act
        var response = await client.GetAsync("/api/v1/projects/web", _ct);

        // Assert
        var project = await response.ReadAsync<ProjectDto>();
        Assert.Equal(created.Id, project.Id);
        Assert.Equal($"\"{project.Version}\"", response.Headers.ETag?.Tag);
    }

    [Fact]
    public async Task Private_project_is_404_for_non_members_and_visible_to_admins()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        await (await ownerClient.PostAsJsonAsync("/api/v1/projects", new { key = "SECRET", name = "Secret" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);
        var outsider = await api.LoginAsync(await api.CreateUserAsync());
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));

        // Act
        var outsiderGet = await outsider.GetAsync("/api/v1/projects/SECRET", _ct);
        var outsiderList = await (await outsider.GetAsync("/api/v1/projects", _ct)).ReadAsync<CursorPage<ProjectSummaryDto>>();
        var adminGet = await (await admin.GetAsync("/api/v1/projects/SECRET", _ct)).ReadAsync<ProjectDto>();

        // Assert
        await outsiderGet.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
        Assert.Empty(outsiderList.Items);
        Assert.Equal(ProjectRole.Owner, adminGet.MyRole);
    }

    [Fact]
    public async Task Public_project_is_listed_for_non_members_with_member_access()
    {
        // Arrange
        var ownerClient = await api.LoginAsync(await api.CreateUserAsync());
        await (await ownerClient.PostAsJsonAsync("/api/v1/projects", new { key = "OPEN", name = "Open", visibility = "Public" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var list = await (await outsider.GetAsync("/api/v1/projects", _ct)).ReadAsync<CursorPage<ProjectSummaryDto>>();

        // Assert
        var project = Assert.Single(list.Items);
        Assert.Equal(("OPEN", ProjectRole.Member, 0), (project.Key, project.MyRole, project.OpenTicketCount));
    }

    [Fact]
    public async Task List_pages_with_an_opaque_cursor_and_filters_by_query()
    {
        // Arrange
        var client = await api.CreatePatClientAsync(await api.CreateUserAsync());
        foreach (var key in new[] { "AAA", "BBB", "CCC", "DDD", "EEE" })
            await (await client.PostAsJsonAsync("/api/v1/projects", new { key, name = $"Project {key}" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var first = await (await client.GetAsync("/api/v1/projects?limit=2", _ct)).ReadAsync<CursorPage<ProjectSummaryDto>>();
        var second = await (await client.GetAsync($"/api/v1/projects?limit=2&cursor={first.NextCursor}", _ct)).ReadAsync<CursorPage<ProjectSummaryDto>>();
        var third = await (await client.GetAsync($"/api/v1/projects?limit=2&cursor={second.NextCursor}", _ct)).ReadAsync<CursorPage<ProjectSummaryDto>>();
        var filtered = await (await client.GetAsync("/api/v1/projects?query=ccc", _ct)).ReadAsync<CursorPage<ProjectSummaryDto>>();
        var badCursor = await client.GetAsync("/api/v1/projects?cursor=not-a-cursor", _ct);

        // Assert
        Assert.Equal(["AAA", "BBB"], first.Items.Select(p => p.Key));
        Assert.Equal(["CCC", "DDD"], second.Items.Select(p => p.Key));
        Assert.Equal(["EEE"], third.Items.Select(p => p.Key));
        Assert.Null(third.NextCursor);
        Assert.Equal("CCC", Assert.Single(filtered.Items).Key);
        await badCursor.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.InvalidCursor);
    }

    [Fact]
    public async Task Patch_changes_only_supplied_fields_and_writes_one_activity_entry_per_field()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        var created = await (await client.PostAsJsonAsync("/api/v1/projects", new { key = "WEB", name = "Website", description = "Old" }, _ct)).ReadAsync<ProjectDto>(HttpStatusCode.Created);

        // Act
        var response = await client.PatchAsJsonAsync("/api/v1/projects/WEB", new { name = "Web site", description = (string?)null }, _ct);

        // Assert
        var updated = await response.ReadAsync<ProjectDto>();
        Assert.Equal(("Web site", null, ProjectVisibility.Private), (updated.Name, updated.Description, updated.Visibility));
        Assert.NotEqual(created.Version, updated.Version);
        var fields = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.Action == "project.field.changed").Select(a => a.Field).ToListAsync(_ct));
        Assert.Equal(["description", "name"], fields.Order());
    }

    [Fact]
    public async Task Patch_with_a_stale_if_match_returns_409_concurrency_conflict()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        var created = await (await client.PostAsJsonAsync("/api/v1/projects", new { key = "WEB", name = "Website" }, _ct)).ReadAsync<ProjectDto>(HttpStatusCode.Created);
        await (await client.PatchAsJsonAsync("/api/v1/projects/WEB", new { name = "First edit" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var stale = new HttpRequestMessage(HttpMethod.Patch, "/api/v1/projects/WEB")
        {
            Content = JsonContent.Create(new { name = "Second edit" }),
            Headers = { { "If-Match", $"\"{created.Version}\"" } },
        };

        // Act
        var response = await client.SendAsync(stale, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, AppErrors.ConcurrencyConflict);
    }

    [Fact]
    public async Task Patch_on_a_public_project_by_a_non_member_is_403()
    {
        // Arrange
        var ownerClient = await api.LoginAsync(await api.CreateUserAsync());
        await (await ownerClient.PostAsJsonAsync("/api/v1/projects", new { key = "OPEN", name = "Open", visibility = "Public" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await outsider.PatchAsJsonAsync("/api/v1/projects/OPEN", new { name = "Hijacked" }, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
    }
}
