using System.Net;
using Ticketing.Application.Projects;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Projects;

/// <summary>GET /projects/suggested-identity: the free name and key the "Your first project" walkthrough suggests (D-140).</summary>
[Collection(nameof(ProjectsCollection))]
public sealed class ProjectSuggestionTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Free_values_come_back_as_given()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await client.GetAsync("/api/v1/projects/suggested-identity?name=%20Kasia%27s%20sandbox%20&key=KSS", _ct);

        // Assert
        var result = await response.ReadAsync<SuggestProjectIdentity.Result>(HttpStatusCode.OK);
        Assert.Equal(("Kasia's sandbox", "KSS"), (result.Name, result.Key));
    }

    [Fact]
    public async Task A_name_or_key_taken_by_a_private_project_the_caller_cannot_read_gets_a_suffix()
    {
        // Arrange
        var stranger = await api.CreateUserAsync();
        await api.ProjectAsync(stranger, "KSS");
        await api.ProjectAsync(stranger, "KSS2");
        await api.WithDbAsync(async db =>
        {
            var project = db.Projects.Single(p => p.Key == "KSS");
            project.Rename("KASIA'S SANDBOX");
            return await db.SaveChangesAsync();
        });
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await client.GetAsync("/api/v1/projects/suggested-identity?name=Kasia%27s%20sandbox&key=KSS", _ct);

        // Assert
        var result = await response.ReadAsync<SuggestProjectIdentity.Result>(HttpStatusCode.OK);
        Assert.Equal(("Kasia's sandbox 2", "KSS3"), (result.Name, result.Key));
    }

    [Fact]
    public async Task A_deleted_project_frees_its_name_but_keeps_its_key()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "OLD");
        await api.WithDbAsync(async db =>
        {
            var project = db.Projects.Single(p => p.Key == "OLD");
            var now = DateTimeOffset.UtcNow;
            project.Archive(owner.Id, now);
            project.Delete(owner.Id, now, "OLD");
            return await db.SaveChangesAsync();
        });
        var client = await api.LoginAsync(owner);

        // Act
        var response = await client.GetAsync("/api/v1/projects/suggested-identity?name=OLD%20project&key=OLD", _ct);

        // Assert
        var result = await response.ReadAsync<SuggestProjectIdentity.Result>(HttpStatusCode.OK);
        Assert.Equal(("OLD project", "OLD2"), (result.Name, result.Key));
    }

    [Fact]
    public async Task A_long_key_is_shortened_to_fit_its_suffix()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await api.ProjectAsync(owner, "ABCDEFGHIJ");
        var client = await api.LoginAsync(owner);

        // Act
        var response = await client.GetAsync("/api/v1/projects/suggested-identity?name=Alphabet&key=ABCDEFGHIJ", _ct);

        // Assert
        var result = await response.ReadAsync<SuggestProjectIdentity.Result>(HttpStatusCode.OK);
        Assert.Equal("ABCDEFGHI2", result.Key);
    }

    [Fact]
    public async Task An_invalid_key_or_a_missing_name_is_a_validation_error()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await client.GetAsync("/api/v1/projects/suggested-identity?key=web-1", _ct);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.True(problem.GetProperty("errors").TryGetProperty("key", out _));
        Assert.True(problem.GetProperty("errors").TryGetProperty("name", out _));
    }

    [Fact]
    public async Task Anonymous_callers_are_rejected()
    {
        // Act
        var response = await api.CreateClient().GetAsync("/api/v1/projects/suggested-identity?name=X&key=XX", _ct);

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
