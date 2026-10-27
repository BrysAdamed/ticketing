using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

[Collection(nameof(DocsCollection))]
public sealed class DocDeleteRestoreTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_deleter_can_undo_within_ten_minutes_and_owners_at_any_time()
    {
        // Arrange
        var (owner, member, other) = await TeamAsync("UND");
        var undone = await member.CreatePageAsync("UND", "Undone");
        var expired = await member.CreatePageAsync("UND", "Expired");
        (await member.DeleteAsync($"/api/v1/docs/{undone.Key}", _ct)).EnsureSuccessStatusCode();
        (await member.DeleteAsync($"/api/v1/docs/{expired.Key}", _ct)).EnsureSuccessStatusCode();
        await api.WithDbAsync(db => db.DocNodes.Where(n => n.Id == expired.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.DeletedAt, DateTimeOffset.UtcNow.AddMinutes(-11)), _ct));

        // Act
        var deletedRead = await owner.GetAsync($"/api/v1/docs/{undone.Key}", _ct);
        var byOther = await other.PostAsync($"/api/v1/docs/{undone.Key}/restore", null, _ct);
        var byDeleter = await (await member.PostAsync($"/api/v1/docs/{undone.Key}/restore", null, _ct)).ReadAsync<DocDto>();
        var tooLate = await member.PostAsync($"/api/v1/docs/{expired.Key}/restore", null, _ct);
        var byOwner = await (await owner.PostAsync($"/api/v1/docs/{expired.Key}/restore", null, _ct)).ReadAsync<DocDto>();
        var notDeleted = await owner.PostAsync($"/api/v1/docs/{expired.Key}/restore", null, _ct);

        // Assert
        await deletedRead.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.Deleted);
        await byOther.ShouldBeProblemAsync(HttpStatusCode.Forbidden, DocErrors.RestoreForbidden);
        Assert.Equal("Undone", byDeleter.Title);
        await tooLate.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.RestoreExpired);
        Assert.Equal("Expired", byOwner.Title);
        await notDeleted.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.NotDeleted);
        Assert.Equal(["Undone", "Expired"], (await owner.GetTreeAsync("UND")).Titles());
    }

    [Fact]
    public async Task A_folder_is_deleted_and_restored_with_its_subtree_as_one_group_drafts_included()
    {
        // Arrange
        var (owner, _, _) = await TeamAsync("GRP");
        var folder = await owner.CreateFolderAsync("GRP", "Folder");
        var sub = await owner.CreateFolderAsync("GRP", "Sub", folder.Key);
        var leaf = await owner.CreatePageAsync("GRP", "Leaf", sub.Key);
        var earlier = await owner.CreatePageAsync("GRP", "Deleted earlier", folder.Key);
        await (await owner.PutAsJsonAsync($"/api/v1/docs/{leaf.Key}/draft", new { baseVersion = 1, content = "wip" }, _ct)).ReadAsync<DocDraftDto>();
        (await owner.DeleteAsync($"/api/v1/docs/{earlier.Key}", _ct)).EnsureSuccessStatusCode();

        // Act
        var deleted = await (await owner.DeleteAsync($"/api/v1/docs/{folder.Key}", _ct)).ReadAsync<DeleteDoc.Result>();
        var leafWhileDeleted = await owner.GetAsync($"/api/v1/docs/{leaf.Key}", _ct);
        var restored = await (await owner.PostAsync($"/api/v1/docs/{leaf.Key}/restore", null, _ct)).ReadAsync<DocDto>();
        var draft = await owner.GetAsync($"/api/v1/docs/{leaf.Key}/draft", _ct);

        // Assert
        Assert.Equal(3, deleted.DeletedCount);
        await leafWhileDeleted.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.Deleted);
        Assert.Equal(folder.Key, restored.Key);
        Assert.Equal(["Folder", ">Sub", ">>Leaf"], (await owner.GetTreeAsync("GRP")).Titles());
        await draft.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(1, await api.WithDbAsync(db => db.DocNodes.CountAsync(n => n.DeletedAt != null, _ct)));
    }

    [Fact]
    public async Task Restore_goes_to_the_root_when_the_former_folder_is_gone_and_renames_on_a_clash()
    {
        // Arrange
        var (owner, _, _) = await TeamAsync("CLS");
        var folder = await owner.CreateFolderAsync("CLS", "Folder");
        var orphan = await owner.CreatePageAsync("CLS", "Orphan", folder.Key);
        var notes = await owner.CreatePageAsync("CLS", "Notes");
        (await owner.DeleteAsync($"/api/v1/docs/{orphan.Key}", _ct)).EnsureSuccessStatusCode();
        (await owner.DeleteAsync($"/api/v1/docs/{folder.Key}", _ct)).EnsureSuccessStatusCode();
        (await owner.DeleteAsync($"/api/v1/docs/{notes.Key}", _ct)).EnsureSuccessStatusCode();
        await owner.CreatePageAsync("CLS", "notes");

        // Act
        var movedToRoot = await (await owner.PostAsync($"/api/v1/docs/{orphan.Key}/restore", null, _ct)).ReadAsync<DocDto>();
        var renamed = await (await owner.PostAsync($"/api/v1/docs/{notes.Key}/restore", null, _ct)).ReadAsync<DocDto>();

        // Assert
        Assert.Equal(("Orphan", null), (movedToRoot.Path, movedToRoot.ParentKey));
        Assert.Equal("Notes (restored)", renamed.Title);
    }

    [Fact]
    public async Task Owners_list_the_trash_by_delete_group_and_others_cannot()
    {
        // Arrange
        var (owner, member, _) = await TeamAsync("TRS");
        var folder = await owner.CreateFolderAsync("TRS", "Folder");
        await owner.CreatePageAsync("TRS", "Child", folder.Key);
        var page = await member.CreatePageAsync("TRS", "Page");
        (await owner.DeleteAsync($"/api/v1/docs/{folder.Key}", _ct)).EnsureSuccessStatusCode();
        (await member.DeleteAsync($"/api/v1/docs/{page.Key}", _ct)).EnsureSuccessStatusCode();

        // Act
        var first = await (await owner.GetAsync("/api/v1/projects/TRS/docs/trash?limit=1", _ct)).ReadAsync<CursorPage<DocTrashItemDto>>();
        var second = await (await owner.GetAsync($"/api/v1/projects/TRS/docs/trash?limit=1&cursor={first.NextCursor}", _ct)).ReadAsync<CursorPage<DocTrashItemDto>>();
        var byMember = await member.GetAsync("/api/v1/projects/TRS/docs/trash", _ct);

        // Assert
        Assert.Equal(("Page", 1), (first.Items[0].Title, first.Items[0].Count));
        Assert.Equal(("Folder", 2, "Folder"), (second.Items[0].Title, second.Items[0].Count, second.Items[0].FormerPath));
        Assert.Null(second.NextCursor);
        await byMember.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
    }

    private async Task<(HttpClient Owner, HttpClient Member, HttpClient Other)> TeamAsync(string key)
    {
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        var project = await owner.CreateProjectAsync(key);
        var memberUser = await api.CreateUserAsync();
        var otherUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, memberUser, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, otherUser, ProjectRole.Member);
        return (owner, await api.LoginAsync(memberUser), await api.LoginAsync(otherUser));
    }
}
