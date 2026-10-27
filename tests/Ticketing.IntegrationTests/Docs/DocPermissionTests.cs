using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Application.Projects;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>The docs permission matrix (spec 1.5), row by row.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocPermissionTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Any_signed_in_user_writes_docs_of_a_public_project()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("OPEN", ProjectVisibility.Public);
        var stranger = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var page = await stranger.CreatePageAsync("OPEN", "From a non-member", content: "hi");
        var updated = await (await stranger.PatchDocAsync(page.Key, new { content = "edited", baseVersion = 1 })).ReadAsync<DocDto>();
        var seenByOwner = await owner.GetDocAsync(page.Key);

        // Assert
        Assert.Equal(ProjectRole.Member, page.MyRole);
        Assert.True(page.Permissions.CanEdit);
        Assert.Equal(2, updated.Version);
        Assert.Equal("edited", seenByOwner.Content);
    }

    [Fact]
    public async Task Viewers_read_but_cannot_write_and_read_only_tokens_cannot_write()
    {
        // Arrange
        var (owner, project) = await OwnedProjectAsync("VIEW");
        var folder = await owner.CreateFolderAsync("VIEW", "Folder");
        var page = await owner.CreatePageAsync("VIEW", "Page", folder.Key, "content");
        var viewerUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewerUser, ProjectRole.Viewer);
        var viewer = await api.LoginAsync(viewerUser);
        var readOnly = await api.CreatePatClientAsync(viewerUser, PatScope.ReadOnly);

        // Act
        var read = await viewer.GetDocAsync(page.Key);
        var tree = await viewer.GetTreeAsync("VIEW");
        var writes = new[]
        {
            await viewer.PostAsJsonAsync("/api/v1/projects/VIEW/docs", new { kind = "Page", title = "Nope" }, _ct),
            await viewer.PatchDocAsync(page.Key, new { title = "Nope" }),
            await viewer.PostAsJsonAsync($"/api/v1/docs/{page.Key}/edits", new { edits = new[] { new { oldText = "content", newText = "x" } } }, _ct),
            await viewer.MoveDocAsync(page.Key, new { parent = "root" }),
            await viewer.PostAsync($"/api/v1/docs/{page.Key}/duplicate", null, _ct),
            await viewer.DeleteAsync($"/api/v1/docs/{page.Key}", _ct),
            await viewer.PutAsJsonAsync($"/api/v1/docs/{page.Key}/draft", new { baseVersion = 1, content = "x" }, _ct),
        };
        var tokenWrite = await readOnly.PostAsJsonAsync("/api/v1/projects/VIEW/docs", new { kind = "Page", title = "Nope" }, _ct);
        var tokenRead = await readOnly.GetAsync($"/api/v1/docs/{page.Key}", _ct);

        // Assert
        Assert.Equal("content", read.Content);
        Assert.Equal(new DocPermissionsDto(false, false), read.Permissions);
        Assert.False(tree.CanWrite);
        Assert.All(tree.Items, i => Assert.False(i.CanDelete));
        foreach (var write in writes)
            await write.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await tokenWrite.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
        await tokenRead.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Members_delete_their_own_pages_and_empty_folders_but_not_others_work()
    {
        // Arrange
        var (owner, project) = await OwnedProjectAsync("MEM");
        var memberUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, memberUser, ProjectRole.Member);
        var member = await api.LoginAsync(memberUser);
        var ownersPage = await owner.CreatePageAsync("MEM", "Owner's page");
        var ownPage = await member.CreatePageAsync("MEM", "Member's page");
        var ownFolder = await member.CreateFolderAsync("MEM", "Member's folder");
        await owner.CreatePageAsync("MEM", "Inside", ownFolder.Key);
        var emptyFolder = await member.CreateFolderAsync("MEM", "Empty");
        var memberTree = await member.GetTreeAsync("MEM");

        // Act
        var others = await member.DeleteAsync($"/api/v1/docs/{ownersPage.Key}", _ct);
        var notEmpty = await member.DeleteAsync($"/api/v1/docs/{ownFolder.Key}", _ct);
        var own = await (await member.DeleteAsync($"/api/v1/docs/{ownPage.Key}", _ct)).ReadAsync<DeleteDoc.Result>();
        var empty = await (await member.DeleteAsync($"/api/v1/docs/{emptyFolder.Key}", _ct)).ReadAsync<DeleteDoc.Result>();
        var byOwner = await (await owner.DeleteAsync($"/api/v1/docs/{ownFolder.Key}", _ct)).ReadAsync<DeleteDoc.Result>();

        // Assert
        Assert.Equal(
            [("Owner's page", false), ("Member's page", true), ("Member's folder", false), ("Inside", false), ("Empty", true)],
            memberTree.Items.Select(i => (i.Title, i.CanDelete)));
        await others.ShouldBeProblemAsync(HttpStatusCode.Forbidden, DocErrors.DeleteForbidden);
        await notEmpty.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.FolderNotEmpty);
        Assert.Equal((1, 1, 2), (own.DeletedCount, empty.DeletedCount, byOwner.DeletedCount));
        Assert.Equal(["Owner's page"], (await owner.GetTreeAsync("MEM")).Titles());
    }

    [Fact]
    public async Task Archived_projects_are_read_only_for_docs()
    {
        // Arrange
        var (owner, _) = await OwnedProjectAsync("ARC");
        var page = await owner.CreatePageAsync("ARC", "Page", content: "x");
        await (await owner.PutAsJsonAsync($"/api/v1/docs/{page.Key}/draft", new { baseVersion = 1, content = "draft" }, _ct)).ReadAsync<DocDraftDto>();
        (await owner.PostAsync("/api/v1/projects/ARC/archive", null, _ct)).EnsureSuccessStatusCode();

        // Act
        var read = await owner.GetDocAsync(page.Key);
        var tree = await owner.GetTreeAsync("ARC");
        var draft = await owner.GetAsync($"/api/v1/docs/{page.Key}/draft", _ct);
        var writes = new[]
        {
            await owner.PostAsJsonAsync("/api/v1/projects/ARC/docs", new { kind = "Page", title = "Nope" }, _ct),
            await owner.PatchDocAsync(page.Key, new { content = "y", baseVersion = 1 }),
            await owner.MoveDocAsync(page.Key, new { position = "Top" }),
            await owner.DeleteAsync($"/api/v1/docs/{page.Key}", _ct),
            await owner.PutAsJsonAsync($"/api/v1/docs/{page.Key}/draft", new { baseVersion = 1, content = "y" }, _ct),
        };

        // Assert
        Assert.False(read.Permissions.CanEdit);
        Assert.Equal((false, false), (tree.CanWrite, tree.CanManageTrash));
        await draft.ShouldHaveStatusAsync(HttpStatusCode.OK);
        foreach (var write in writes)
            await write.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
        Assert.Equal(1, await api.WithDbAsync(db => db.DocVersions.CountAsync(_ct)));
    }

    private async Task<(HttpClient Owner, ProjectDto Project)> OwnedProjectAsync(string key)
    {
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        return (owner, await owner.CreateProjectAsync(key));
    }
}
