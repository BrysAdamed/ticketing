using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Attachments;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Attachments;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Attachments;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Page attachments (docs refinement 1.3, 1.5, 1.12): the ticket attachment rules on a page, 200 per page.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocAttachmentTests(TicketingApiFactory api)
{
    private static readonly byte[] Png = AttachmentTests.Png;

    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Members_upload_images_to_a_page_and_viewers_list_and_download_them_without_a_new_version()
    {
        // Arrange
        var world = await SeedAsync("IMG");
        var page = await world.Owner.CreatePageAsync("IMG", "Design", content: "# Design");
        var before = await api.WithDbAsync(db => db.DocNodes.Where(n => n.Id == page.Id).Select(n => n.UpdatedAt).SingleAsync(_ct));

        // Act
        var response = await world.Member.UploadDocAttachmentAsync(page.Key, "C:\\shots\\flow chart.png", "image/png", Png);
        var uploaded = await response.ReadAsync<DocAttachmentDto>(HttpStatusCode.Created);
        var list = await (await world.Viewer.GetAsync($"/api/v1/docs/{page.Key}/attachments", _ct)).ReadAsync<List<DocAttachmentDto>>();
        var download = await world.Viewer.GetAsync(uploaded.Url, _ct);
        var doc = await world.Owner.GetDocAsync(page.Key);

        // Assert
        Assert.Equal(uploaded.Url, response.Headers.Location?.OriginalString);
        Assert.Equal((page.Key, "flow chart.png", "image/png", Png.Length, true, true),
            (uploaded.DocKey, uploaded.FileName, uploaded.ContentType, uploaded.SizeBytes, uploaded.IsImage, uploaded.CanDelete));
        Assert.Equal($"/api/v1/attachments/{uploaded.Id}", uploaded.Url);
        Assert.Equal(world.MemberUser.Email, uploaded.UploadedBy.Email);
        var listed = Assert.Single(list);
        Assert.Equal((uploaded.Id, false), (listed.Id, listed.CanDelete));
        await download.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal("image/png", download.Content.Headers.ContentType?.MediaType);
        Assert.Equal("inline", download.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal(Png, await download.Content.ReadAsByteArrayAsync(_ct));
        Assert.Equal((1, before), (doc.Version, doc.UpdatedAt));
        Assert.Equal(1, await api.WithDbAsync(db => db.DocVersions.CountAsync(_ct)));
        var activity = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.EntityId == page.Id).Select(a => new { a.EntityType, a.Action, a.NewValue }).ToListAsync(_ct));
        var added = Assert.Single(activity, a => a.Action == UploadDocAttachment.Action);
        Assert.Equal(ActivityEntityType.Doc, added.EntityType);
        Assert.Contains(uploaded.Id.ToString(), added.NewValue, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Only_pages_take_attachments()
    {
        // Arrange
        var world = await SeedAsync("KIND");
        var folder = await world.Owner.CreateFolderAsync("KIND", "Folder");
        var diagram = await world.Owner.CreateDocAsync("KIND", new { kind = "Diagram", diagramFormat = "Mermaid", title = "Flow", content = "flowchart LR\n  a --> b" });

        // Act
        var toFolder = await world.Member.UploadDocAttachmentAsync(folder.Key, "a.png", "image/png", Png);
        var toDiagram = await world.Member.UploadDocAttachmentAsync(diagram.Key, "a.png", "image/png", Png);

        // Assert
        await toFolder.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.KindUnsupported);
        await toDiagram.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.KindUnsupported);
        Assert.Equal(0, await api.WithDbAsync(db => db.Attachments.CountAsync(_ct)));
    }

    [Fact]
    public async Task Oversized_mismatching_and_the_201st_files_are_rejected()
    {
        // Arrange
        var world = await SeedAsync("LIM");
        var page = await world.Owner.CreatePageAsync("LIM", "Gallery");
        var tooBig = new byte[Attachment.MaxSizeBytes + 1];
        Png.CopyTo(tooBig, 0);
        var big = await world.Member.UploadDocAttachmentAsync(page.Key, "big.png", "image/png", tooBig);
        var fake = await world.Member.UploadDocAttachmentAsync(page.Key, "fake.png", "image/png", Encoding.UTF8.GetBytes("not really a png"));
        await api.WithDbAsync(async db =>
        {
            for (var i = 0; i < Attachment.MaxPerDoc - 1; i++)
                db.Attachments.Add(Attachment.CreateForDoc(page.Id, $"f{i}.txt", "text/plain", 1, new string('0', 64), world.MemberUser.Id, DateTimeOffset.UtcNow));
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var last = await world.Member.UploadDocAttachmentAsync(page.Key, "last.png", "image/png", Png);
        var overLimit = await world.Member.UploadDocAttachmentAsync(page.Key, "one-more.png", "image/png", Png);

        // Assert
        await big.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AttachmentErrors.SizeInvalid);
        await fake.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AttachmentErrors.TypeMismatch);
        await last.ShouldHaveStatusAsync(HttpStatusCode.Created);
        var problem = await overLimit.ShouldBeProblemAsync(HttpStatusCode.Conflict, AttachmentErrors.LimitReached);
        Assert.Equal("Delete an attachment first.", problem.GetProperty("hint").GetString());
        Assert.Equal(Attachment.MaxPerDoc, await api.WithDbAsync(db => db.Attachments.CountAsync(a => a.DocNodeId == page.Id, _ct)));
    }

    [Fact]
    public async Task Viewers_and_read_only_tokens_cannot_upload_but_anyone_signed_in_can_on_a_public_project()
    {
        // Arrange
        var world = await SeedAsync("VIEWA");
        var page = await world.Owner.CreatePageAsync("VIEWA", "Page");
        var readOnly = await api.CreatePatClientAsync(world.MemberUser, PatScope.ReadOnly);
        await world.Owner.CreateProjectAsync("OPENA", ProjectVisibility.Public);
        var publicPage = await world.Owner.CreatePageAsync("OPENA", "Public page");
        var stranger = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var byViewer = await world.Viewer.UploadDocAttachmentAsync(page.Key, "a.png", "image/png", Png);
        var byToken = await readOnly.UploadDocAttachmentAsync(page.Key, "a.png", "image/png", Png);
        var byStranger = await stranger.UploadDocAttachmentAsync(publicPage.Key, "a.png", "image/png", Png);

        // Assert
        await byViewer.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await byToken.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
        Assert.True((await byStranger.ReadAsync<DocAttachmentDto>(HttpStatusCode.Created)).CanDelete);
    }

    [Fact]
    public async Task Members_delete_their_own_uploads_owners_delete_any_and_the_page_is_left_as_it_was()
    {
        // Arrange
        var world = await SeedAsync("DEL");
        var page = await world.Owner.CreatePageAsync("DEL", "Page", content: "x");
        var before = await api.WithDbAsync(db => db.DocNodes.Where(n => n.Id == page.Id).Select(n => n.UpdatedAt).SingleAsync(_ct));
        var first = await (await world.Member.UploadDocAttachmentAsync(page.Key, "a.png", "image/png", Png)).ReadAsync<DocAttachmentDto>(HttpStatusCode.Created);
        var second = await (await world.Member.UploadDocAttachmentAsync(page.Key, "b.png", "image/png", Png)).ReadAsync<DocAttachmentDto>(HttpStatusCode.Created);
        var otherList = await (await world.OtherMember.GetAsync($"/api/v1/docs/{page.Key}/attachments", _ct)).ReadAsync<List<DocAttachmentDto>>();

        // Act
        var byOther = await world.OtherMember.DeleteAsync(first.Url, _ct);
        var byUploader = await world.Member.DeleteAsync(first.Url, _ct);
        var byOwner = await world.Owner.DeleteAsync(second.Url, _ct);
        var afterDelete = await world.Member.GetAsync(first.Url, _ct);

        // Assert
        Assert.All(otherList, a => Assert.False(a.CanDelete));
        await byOther.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AttachmentErrors.Forbidden);
        await byUploader.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await byOwner.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await afterDelete.ShouldBeProblemAsync(HttpStatusCode.NotFound, AttachmentErrors.NotFound);
        Assert.Equal(0, await api.WithDbAsync(db => db.Set<Ticketing.Infrastructure.Persistence.AttachmentContent>().CountAsync(_ct)));
        var doc = await world.Owner.GetDocAsync(page.Key);
        Assert.Equal((1, before), (doc.Version, doc.UpdatedAt));
        var actions = await api.WithDbAsync(db => db.ActivityEntries
            .Where(a => a.EntityId == page.Id && a.EntityType == ActivityEntityType.Doc)
            .Select(a => a.Action)
            .ToListAsync(_ct));
        Assert.Equal(2, actions.Count(a => a == UploadDocAttachment.Action));
        Assert.Equal(2, actions.Count(a => a == DeleteAttachment.DocAction));
    }

    [Fact]
    public async Task Archived_projects_keep_attachments_readable_but_refuse_uploads_and_deletes()
    {
        // Arrange
        var world = await SeedAsync("ARCA");
        var page = await world.Owner.CreatePageAsync("ARCA", "Page");
        var uploaded = await (await world.Member.UploadDocAttachmentAsync(page.Key, "a.png", "image/png", Png)).ReadAsync<DocAttachmentDto>(HttpStatusCode.Created);
        (await world.Owner.PostAsync("/api/v1/projects/ARCA/archive", null, _ct)).EnsureSuccessStatusCode();

        // Act
        var list = await (await world.Owner.GetAsync($"/api/v1/docs/{page.Key}/attachments", _ct)).ReadAsync<List<DocAttachmentDto>>();
        var download = await world.Member.GetAsync(uploaded.Url, _ct);
        var upload = await world.Member.UploadDocAttachmentAsync(page.Key, "b.png", "image/png", Png);
        var delete = await world.Owner.DeleteAsync(uploaded.Url, _ct);

        // Assert
        Assert.False(Assert.Single(list).CanDelete);
        await download.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await upload.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
        await delete.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
    }

    [Fact]
    public async Task Attachments_of_a_deleted_page_are_not_found()
    {
        // Arrange
        var world = await SeedAsync("GONE");
        var page = await world.Owner.CreatePageAsync("GONE", "Page");
        var uploaded = await (await world.Member.UploadDocAttachmentAsync(page.Key, "a.png", "image/png", Png)).ReadAsync<DocAttachmentDto>(HttpStatusCode.Created);
        (await world.Owner.DeleteAsync($"/api/v1/docs/{page.Key}", _ct)).EnsureSuccessStatusCode();

        // Act
        var download = await world.Member.GetAsync(uploaded.Url, _ct);
        var delete = await world.Member.DeleteAsync(uploaded.Url, _ct);
        var list = await world.Member.GetAsync($"/api/v1/docs/{page.Key}/attachments", _ct);

        // Assert
        await download.ShouldBeProblemAsync(HttpStatusCode.NotFound, AttachmentErrors.NotFound);
        await delete.ShouldBeProblemAsync(HttpStatusCode.NotFound, AttachmentErrors.NotFound);
        await list.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.Deleted);
    }

    [Fact]
    public async Task Mcp_lists_page_attachments_and_reads_their_text_with_a_read_only_token()
    {
        // Arrange
        var world = await SeedAsync("MCPA");
        var page = await world.Owner.CreatePageAsync("MCPA", "Runbook");
        var json = await (await world.Member.UploadDocAttachmentAsync(page.Key, "config.json", "application/json", Encoding.UTF8.GetBytes("{\"retries\":3}")))
            .ReadAsync<DocAttachmentDto>(HttpStatusCode.Created);
        await (await world.Member.UploadDocAttachmentAsync(page.Key, "a.png", "image/png", Png)).ReadAsync<DocAttachmentDto>(HttpStatusCode.Created);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.ViewerUser, PatScope.ReadOnly));

        // Act
        var list = await mcp.CallToolAsync("list_doc_attachments", new Dictionary<string, object?> { ["docKey"] = page.Key }, cancellationToken: _ct);
        var text = await mcp.CallToolAsync("get_attachment_text", new Dictionary<string, object?> { ["attachmentId"] = json.Id }, cancellationToken: _ct);

        // Assert
        Assert.True(list.IsError != true);
        Assert.Equal(["config.json", "a.png"], Payload(list).EnumerateArray().Select(a => a.GetProperty("fileName").GetString()));
        Assert.Equal(page.Key, Payload(list)[0].GetProperty("docKey").GetString());
        Assert.Equal("{\"retries\":3}", Payload(text).GetProperty("text").GetString());
    }

    private async Task<World> SeedAsync(string key)
    {
        var ownerUser = await api.CreateUserAsync();
        var memberUser = await api.CreateUserAsync();
        var otherMemberUser = await api.CreateUserAsync();
        var viewerUser = await api.CreateUserAsync();
        var owner = await api.LoginAsync(ownerUser);
        var project = await owner.CreateProjectAsync(key);
        await api.AddMemberAsync(project.Id, memberUser, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, otherMemberUser, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, viewerUser, ProjectRole.Viewer);
        return new World(
            owner, await api.LoginAsync(memberUser), await api.LoginAsync(otherMemberUser), await api.LoginAsync(viewerUser), memberUser, viewerUser);
    }

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;

    private sealed record World(HttpClient Owner, HttpClient Member, HttpClient OtherMember, HttpClient Viewer, TestUser MemberUser, TestUser ViewerUser);
}
