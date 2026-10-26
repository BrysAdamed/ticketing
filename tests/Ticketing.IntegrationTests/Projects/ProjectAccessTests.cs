using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Projects;

/// <summary>Spec 5.1 and 5.3 against the real database, through <see cref="IProjectAccess"/> as every slice uses it.</summary>
[Collection(nameof(ApiCollection))]
public sealed class ProjectAccessTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Public_project_is_writable_by_a_signed_in_non_member()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var projectId = await CreateProjectAsync(owner, ProjectVisibility.Public);
        var outsider = await api.CreateUserAsync();

        // Act
        var grant = await api.ExecuteAsAsync(outsider, sp => sp.GetRequiredService<IProjectAccess>().EnsureCanWriteAsync(projectId, _ct));

        // Assert
        Assert.Equal(ProjectRole.Member, grant.Role);
    }

    [Fact]
    public async Task Private_project_is_not_found_for_a_non_member()
    {
        // Arrange
        var projectId = await CreateProjectAsync(await api.CreateUserAsync(), ProjectVisibility.Private);
        var outsider = await api.CreateUserAsync();

        // Act
        var error = await Assert.ThrowsAsync<AppException>(() =>
            api.ExecuteAsAsync(outsider, sp => sp.GetRequiredService<IProjectAccess>().EnsureCanReadAsync(projectId, _ct)));

        // Assert
        Assert.Equal((ErrorKind.NotFound, ProjectErrors.NotFound), (error.Kind, error.Code));
    }

    [Fact]
    public async Task Viewer_can_read_a_private_project_but_not_write()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var projectId = await CreateProjectAsync(owner, ProjectVisibility.Private, (viewer, ProjectRole.Viewer));

        // Act
        var read = await api.ExecuteAsAsync(viewer, sp => sp.GetRequiredService<IProjectAccess>().EnsureCanReadAsync(projectId, _ct));
        var write = await Assert.ThrowsAsync<AppException>(() =>
            api.ExecuteAsAsync(viewer, sp => sp.GetRequiredService<IProjectAccess>().EnsureCanWriteAsync(projectId, _ct)));

        // Assert
        Assert.Equal(ProjectRole.Viewer, read.Role);
        Assert.Equal((ErrorKind.Forbidden, ProjectErrors.Forbidden), (write.Kind, write.Code));
    }

    [Fact]
    public async Task Viewer_membership_on_a_public_project_still_grants_member_access()
    {
        // Arrange
        var viewer = await api.CreateUserAsync();
        var projectId = await CreateProjectAsync(await api.CreateUserAsync(), ProjectVisibility.Public, (viewer, ProjectRole.Viewer));

        // Act
        var grant = await api.ExecuteAsAsync(viewer, sp => sp.GetRequiredService<IProjectAccess>().EnsureCanWriteAsync(projectId, _ct));

        // Assert
        Assert.Equal(ProjectRole.Member, grant.Role);
    }

    [Fact]
    public async Task Admin_is_owner_of_every_project()
    {
        // Arrange
        var projectId = await CreateProjectAsync(await api.CreateUserAsync(), ProjectVisibility.Private);
        var admin = await api.CreateUserAsync(GlobalRole.Admin);

        // Act
        var grant = await api.ExecuteAsAsync(admin, sp => sp.GetRequiredService<IProjectAccess>().EnsureOwnerAsync(projectId, _ct));

        // Assert
        Assert.Equal(ProjectRole.Owner, grant.Role);
    }

    [Fact]
    public async Task Read_only_token_cannot_write_even_as_owner()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var projectId = await CreateProjectAsync(owner, ProjectVisibility.Private);

        // Act
        var error = await Assert.ThrowsAsync<AppException>(() =>
            api.ExecuteAsAsync(owner, sp => sp.GetRequiredService<IProjectAccess>().EnsureCanWriteAsync(projectId, _ct), PatScope.ReadOnly));

        // Assert
        Assert.Equal(AppErrors.ReadOnlyToken, error.Code);
    }

    [Fact]
    public async Task Archived_project_rejects_writes_with_409()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var projectId = await CreateProjectAsync(owner, ProjectVisibility.Private);
        await api.WithDbAsync(async db =>
        {
            (await db.Projects.SingleAsync(p => p.Id == projectId, _ct)).Archive(owner.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var error = await Assert.ThrowsAsync<AppException>(() =>
            api.ExecuteAsAsync(owner, sp => sp.GetRequiredService<IProjectAccess>().EnsureCanWriteAsync(projectId, _ct)));

        // Assert
        Assert.Equal((ErrorKind.Conflict, ProjectErrors.Archived), (error.Kind, error.Code));
    }

    [Fact]
    public async Task Readable_projects_excludes_private_and_deleted_projects()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        await CreateProjectAsync(owner, ProjectVisibility.Private, key: "PRIV");
        await CreateProjectAsync(owner, ProjectVisibility.Public, key: "PUB");
        var outsider = await api.CreateUserAsync();

        // Act
        var keys = await api.ExecuteAsAsync(outsider, sp => sp.GetRequiredService<IProjectAccess>().ReadableProjects().Select(p => p.Key).ToListAsync(_ct));

        // Assert
        Assert.Equal(["PUB"], keys);
    }

    private Task<Guid> CreateProjectAsync(TestUser owner, ProjectVisibility visibility, (TestUser User, ProjectRole Role)? member = null, string? key = null) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var project = Project.Create(key ?? $"P{Guid.NewGuid():N}"[..8].ToUpperInvariant(), $"Project {Guid.NewGuid():N}", null, visibility, owner.Id, now);
            if (member is { } m)
                project.AddMember(m.User.Id, m.Role, owner.Id, now);
            db.Projects.Add(project);
            await db.SaveChangesAsync(_ct);
            return project.Id;
        });
}
