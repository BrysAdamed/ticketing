using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Docs;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

[Collection(nameof(DocsCollection))]
public sealed class DocContentTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Publishing_content_needs_the_current_base_version_and_reports_who_changed_it()
    {
        // Arrange
        var (jane, janeUser, joe, _) = await TwoWritersAsync("PUB");
        var page = await jane.CreatePageAsync("PUB", "Spec", content: "one");

        // Act
        var missing = await joe.PatchDocAsync(page.Key, new { content = "joe" });
        var janes = await (await jane.PatchDocAsync(page.Key, new { content = "two", baseVersion = 1, changeNote = "Second" })).ReadAsync<DocDto>();
        var stale = await joe.PatchDocAsync(page.Key, new { content = "joe", baseVersion = 1 });

        // Assert
        await missing.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.BaseVersionRequired);
        Assert.Equal((2, "two"), (janes.Version, janes.Content));
        var conflict = await stale.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.VersionConflict);
        Assert.Equal(2, conflict.GetProperty("currentVersion").GetInt32());
        Assert.Equal(janeUser.Email, conflict.GetProperty("updatedBy").GetProperty("email").GetString());
        Assert.True(conflict.TryGetProperty("updatedAt", out _));
        var versions = await api.WithDbAsync(db => db.DocVersions.OrderBy(v => v.Number).ToListAsync(_ct));
        Assert.Equal([(1, "one", null), (2, "two", "Second")], versions.Select(v => (v.Number, v.Content, v.ChangeNote)));
        Assert.All(versions, v => Assert.Equal(WriteChannel.Web, v.Channel));
    }

    [Fact]
    public async Task Rename_creates_no_version_and_the_next_version_snapshots_the_new_title()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("REN");
        var page = await client.CreatePageAsync("REN", "Draft name", content: "body");

        // Act
        var renamed = await (await client.PatchDocAsync(page.Key, new { title = "Final name" })).ReadAsync<DocDto>();
        var same = await (await client.PatchDocAsync(page.Key, new { content = "body", baseVersion = 1 })).ReadAsync<DocDto>();
        var published = await (await client.PatchDocAsync(page.Key, new { title = "Final name", content = "body 2", baseVersion = 1 })).ReadAsync<DocDto>();

        // Assert
        Assert.Equal((1, "Final name"), (renamed.Version, renamed.Title));
        Assert.Equal(1, same.Version);
        Assert.Equal(2, published.Version);
        var latest = await api.WithDbAsync(db => db.DocVersions.SingleAsync(v => v.Number == 2, _ct));
        Assert.Equal("Final name", latest.Title);
        var actions = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.EntityType == ActivityEntityType.Doc).OrderBy(a => a.OccurredAt).Select(a => a.Action).ToListAsync(_ct));
        Assert.Equal([CreateDoc.Action, UpdateDoc.RenamedAction, DocPublisher.UpdatedAction], actions);
    }

    [Fact]
    public async Task Content_limits_and_kinds_are_enforced()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("LIM");
        var folder = await client.CreateFolderAsync("LIM", "Folder");
        var page = await client.CreatePageAsync("LIM", "Page");

        // Act
        var tooLong = await client.PatchDocAsync(page.Key, new { content = new string('x', DocNode.PageContentMaxLength + 1), baseVersion = 1 });
        var mermaid = await client.PostAsJsonAsync("/api/v1/projects/LIM/docs",
            new { kind = "Diagram", diagramFormat = "Mermaid", title = "Big", content = new string('x', DocNode.MermaidSourceMaxLength + 1) }, _ct);
        var noFormat = await client.PostAsJsonAsync("/api/v1/projects/LIM/docs", new { kind = "Diagram", title = "No format" }, _ct);
        var folderContent = await client.PatchDocAsync(folder.Key, new { content = "x", baseVersion = 0 });
        var exact = await client.PatchDocAsync(page.Key, new { content = new string('x', DocNode.PageContentMaxLength), baseVersion = 1 });

        // Assert
        await tooLong.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.ContentTooLong);
        await mermaid.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.ContentTooLong);
        await noFormat.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        await folderContent.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.KindUnsupported);
        await exact.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Find_replace_edits_apply_to_the_latest_version_all_or_nothing()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("EDT");
        var page = await client.CreatePageAsync("EDT", "Page", content: "alpha beta\r\nbeta gamma");
        var canvas = await client.CreateDocAsync("EDT", new { kind = "Diagram", diagramFormat = "Canvas", title = "Board", content = "{}" });

        // Act
        var noMatch = await Edits(client, page.Key, new { oldText = "alpha", newText = "A" }, new { oldText = "delta", newText = "D" });
        var ambiguous = await Edits(client, page.Key, new { oldText = "beta", newText = "B" });
        var secondFails = await Edits(client, page.Key,
            new { oldText = "beta", newText = "B", replaceAll = true }, new { oldText = "alpha B\ngamma", newText = "never" });
        var onCanvas = await Edits(client, canvas.Key, new { oldText = "{", newText = "[" });

        // Assert
        var body = await noMatch.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.EditNoMatch);
        Assert.Contains("get_doc", body.GetProperty("hint").GetString(), StringComparison.Ordinal);
        await ambiguous.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.EditAmbiguous);
        await secondFails.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.EditNoMatch);
        Assert.Equal(("alpha beta\nbeta gamma", 1), await ContentAsync(client, page.Key));
        var ok = await (await Edits(client, page.Key, new { oldText = "beta", newText = "B", replaceAll = true }, new { oldText = "B gamma", newText = "end" }))
            .ReadAsync<DocDto>();
        Assert.Equal(("alpha B\nend", 2), (ok.Content, ok.Version));
        await onCanvas.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.KindUnsupported);
    }

    [Fact]
    public async Task Drafts_are_private_show_presence_and_go_away_on_publish()
    {
        // Arrange
        var (jane, janeUser, joe, _) = await TwoWritersAsync("DRF");
        var page = await jane.CreatePageAsync("DRF", "Page", content: "published");

        // Act
        var saved = await (await jane.PutAsJsonAsync($"/api/v1/docs/{page.Key}/draft", new { baseVersion = 1, title = "Page", content = "my edit" }, _ct))
            .ReadAsync<DocDraftDto>();
        var mine = await (await jane.GetAsync($"/api/v1/docs/{page.Key}/draft", _ct)).ReadAsync<DocDraftDto>();
        var theirs = await joe.GetAsync($"/api/v1/docs/{page.Key}/draft", _ct);
        var seenByJoe = await joe.GetDocAsync(page.Key);
        var seenByJane = await jane.GetDocAsync(page.Key);
        var janesTree = await jane.GetTreeAsync("DRF");
        var joesDraft = await joe.PutAsJsonAsync($"/api/v1/docs/{page.Key}/draft", new { baseVersion = 1, title = "", content = "joe" }, _ct);
        await (await jane.PatchDocAsync(page.Key, new { content = "my edit", baseVersion = 1 })).ReadAsync<DocDto>();
        var afterPublish = await jane.GetAsync($"/api/v1/docs/{page.Key}/draft", _ct);
        var joeStillHasOne = await joe.GetAsync($"/api/v1/docs/{page.Key}/draft", _ct);
        var discarded = await joe.DeleteAsync($"/api/v1/docs/{page.Key}/draft", _ct);

        // Assert
        Assert.Equal(("my edit", 1, 1), (saved.Content, saved.BaseVersion, saved.CurrentVersion));
        Assert.Equal("my edit", mine.Content);
        await theirs.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.DraftNotFound);
        Assert.Equal("published", seenByJoe.Content);
        Assert.Equal(janeUser.Email, Assert.Single(seenByJoe.Editors).User.Email);
        Assert.Null(seenByJoe.MyDraft);
        Assert.Empty(seenByJane.Editors);
        Assert.Equal(1, seenByJane.MyDraft!.BaseVersion);
        Assert.True(janesTree.Items.Single().HasMyDraft);
        await joesDraft.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await afterPublish.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.DraftNotFound);
        await joeStillHasOne.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(HttpStatusCode.NoContent, discarded.StatusCode);
        Assert.Equal(0, await api.WithDbAsync(db => db.DocDrafts.CountAsync(_ct)));
    }

    [Fact]
    public async Task Presence_ignores_drafts_older_than_ten_minutes_and_drafts_validate_their_base()
    {
        // Arrange
        var (jane, _, joe, _) = await TwoWritersAsync("PRS");
        var page = await jane.CreatePageAsync("PRS", "Page");
        await (await jane.PutAsJsonAsync($"/api/v1/docs/{page.Key}/draft", new { baseVersion = 1, content = "x" }, _ct)).ReadAsync<DocDraftDto>();
        await api.WithDbAsync(db => db.Database.ExecuteSqlAsync($"UPDATE doc_drafts SET updated_at = now() - interval '11 minutes'", _ct));

        // Act
        var seen = await joe.GetDocAsync(page.Key);
        var future = await joe.PutAsJsonAsync($"/api/v1/docs/{page.Key}/draft", new { baseVersion = 2, content = "x" }, _ct);
        var none = await joe.PutAsJsonAsync($"/api/v1/docs/{page.Key}/draft", new { content = "x" }, _ct);

        // Assert
        Assert.Empty(seen.Editors);
        await future.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.BaseVersionInvalid);
        await none.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
    }

    [Fact]
    public async Task Each_published_version_is_readable_with_its_content_and_author()
    {
        // Arrange
        var (jane, janeUser, joe, joeUser) = await TwoWritersAsync("VER");
        var page = await jane.CreatePageAsync("VER", "Spec", content: "one");
        await (await joe.PatchDocAsync(page.Key, new { content = "two", baseVersion = 1, changeNote = "Second" })).ReadAsync<DocDto>();

        // Act
        var first = await (await joe.GetAsync($"/api/v1/docs/{page.Key}/versions/1", _ct)).ReadAsync<DocVersionDto>();
        var second = await (await jane.GetAsync($"/api/v1/docs/{page.Id}/versions/2", _ct)).ReadAsync<DocVersionDto>();
        var missing = await jane.GetAsync($"/api/v1/docs/{page.Key}/versions/3", _ct);
        var folder = await jane.CreateFolderAsync("VER", "Folder");
        var ofFolder = await jane.GetAsync($"/api/v1/docs/{folder.Key}/versions/1", _ct);

        // Assert
        Assert.Equal((page.Key, 1, "Spec", "one", (string?)null, janeUser.Email, WriteChannel.Web, (int?)null),
            (first.DocKey, first.Number, first.Title, first.Content, first.ChangeNote, first.Author.Email, first.Channel, first.RestoredFrom));
        Assert.Equal((2, "two", "Second", joeUser.Email), (second.Number, second.Content, second.ChangeNote, second.Author.Email));
        Assert.True(second.CreatedAt >= first.CreatedAt);
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.VersionNotFound);
        await ofFolder.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.VersionNotFound);
    }

    [Fact]
    public async Task Pages_export_their_latest_markdown_as_a_file_named_after_the_title()
    {
        // Arrange
        var (jane, _, _, _) = await TwoWritersAsync("EXP");
        var page = await jane.CreatePageAsync("EXP", "Q1/Q2: plans", content: "# Plans\n\nŻółw ships.");
        var empty = await jane.CreatePageAsync("EXP", "???");
        var folder = await jane.CreateFolderAsync("EXP", "Folder");

        // Act
        var export = await jane.GetAsync($"/api/v1/docs/{page.Key}/export.md", _ct);
        var emptyExport = await jane.GetAsync($"/api/v1/docs/{empty.Key}/export.md", _ct);
        var folderExport = await jane.GetAsync($"/api/v1/docs/{folder.Key}/export.md", _ct);

        // Assert
        await export.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(("text/markdown", "utf-8"), (export.Content.Headers.ContentType?.MediaType, export.Content.Headers.ContentType?.CharSet));
        Assert.Equal("attachment", export.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal("Q1 Q2 plans.md", FileName(export));
        Assert.Equal("nosniff", export.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("# Plans\n\nŻółw ships.", await export.Content.ReadAsStringAsync(_ct));
        await emptyExport.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal($"{empty.Key}.md", FileName(emptyExport));
        Assert.Equal(string.Empty, await emptyExport.Content.ReadAsStringAsync(_ct));
        await folderExport.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.KindUnsupported);
    }

    private async Task<(HttpClient Jane, TestUser JaneUser, HttpClient Joe, TestUser JoeUser)> TwoWritersAsync(string key)
    {
        var janeUser = await api.CreateUserAsync();
        var joeUser = await api.CreateUserAsync();
        var jane = await api.LoginAsync(janeUser);
        var project = await jane.CreateProjectAsync(key);
        await api.AddMemberAsync(project.Id, joeUser, ProjectRole.Member);
        return (jane, janeUser, await api.LoginAsync(joeUser), joeUser);
    }

    private Task<HttpResponseMessage> Edits(HttpClient client, string key, params object[] edits) =>
        client.PostAsJsonAsync($"/api/v1/docs/{key}/edits", new { edits }, _ct);

    private static string? FileName(HttpResponseMessage response) =>
        response.Content.Headers.ContentDisposition?.FileNameStar ?? response.Content.Headers.ContentDisposition?.FileName?.Trim('"');

    private static async Task<(string? Content, int Version)> ContentAsync(HttpClient client, string key)
    {
        var doc = await client.GetDocAsync(key);
        return (doc.Content, doc.Version);
    }
}
