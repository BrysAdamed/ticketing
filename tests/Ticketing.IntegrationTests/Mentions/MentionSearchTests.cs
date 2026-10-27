using System.Net;
using Ticketing.Application.Users;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Mentions;

/// <summary>D-95: the mention picker searches users who can read the project (<c>access=read</c>), viewers included.</summary>
[Collection(nameof(MentionsCollection))]
public sealed class MentionSearchTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Read_access_search_includes_viewers_and_write_access_search_does_not()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await api.CreateUserAsync(displayName: "Outsider Olga");

        // Act
        var read = await SearchAsync(world.MemberClient, "projectKey=WEB&access=read");
        var readByName = await SearchAsync(world.MemberClient, "projectKey=WEB&access=Read&query=vie");
        var write = await SearchAsync(world.MemberClient, "projectKey=WEB");
        var explicitWrite = await SearchAsync(world.MemberClient, "projectKey=WEB&access=write");

        // Assert
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member, world.Viewer), read.Select(u => u.Id).Order().ToList());
        Assert.Equal([world.Viewer.Id], readByName.Select(u => u.Id));
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), write.Select(u => u.Id).Order().ToList());
        Assert.Equal(write.Select(u => u.Id), explicitWrite.Select(u => u.Id));
    }

    [Fact]
    public async Task Read_access_search_leaves_out_inactive_users()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await api.DeactivateAsync(world.Viewer, world.Owner);

        // Act
        var read = await SearchAsync(world.OwnerClient, "projectKey=WEB&access=read");

        // Assert
        Assert.DoesNotContain(world.Viewer.Id, read.Select(u => u.Id));
    }

    [Fact]
    public async Task Read_access_search_on_a_public_project_lists_every_active_user()
    {
        // Arrange
        var world = await api.SeedWorldAsync(visibility: ProjectVisibility.Public);
        var passerby = await api.CreateUserAsync(displayName: "Passerby Pat");

        // Act
        var read = await SearchAsync(world.OwnerClient, "projectKey=WEB&access=read&query=pass");

        // Assert
        Assert.Equal([passerby.Id], read.Select(u => u.Id));
    }

    [Fact]
    public async Task Searching_a_private_project_you_cannot_read_is_404()
    {
        // Arrange
        await api.SeedWorldAsync();
        var outsiderClient = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await outsiderClient.GetAsync("/api/v1/users?projectKey=WEB&access=read", _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, ProjectErrors.NotFound);
    }

    private static async Task<IReadOnlyList<UserLookupDto>> SearchAsync(HttpClient client, string query) =>
        await (await client.GetAsync($"/api/v1/users?{query}")).ReadAsync<IReadOnlyList<UserLookupDto>>();
}
