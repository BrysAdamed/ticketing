using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Attachments;
using Ticketing.Domain.Attachments;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Search;

namespace Ticketing.IntegrationTests.Attachments;

[CollectionDefinition(nameof(AttachmentsCollection))]
public sealed class AttachmentsCollection : ICollectionFixture<TicketingApiFactory>;

[Collection(nameof(AttachmentsCollection))]
public sealed class AttachmentTests(TicketingApiFactory api)
{
    public static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");

    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Upload_list_and_download_an_image_inline_with_safe_headers()
    {
        // Arrange
        var world = await SeedAsync();
        var client = await api.LoginAsync(world.Member);
        var before = await api.WithDbAsync(db => db.Tickets.Where(t => t.Id == world.TicketId).Select(t => t.UpdatedAt).SingleAsync(_ct));

        // Act
        var uploaded = await (await UploadAsync(client, "WEB-1", "C:\\shots\\screen shot.png", "image/png", Png)).ReadAsync<AttachmentDto>(HttpStatusCode.Created);
        var list = await (await client.GetAsync("/api/v1/tickets/WEB-1/attachments", _ct)).ReadAsync<List<AttachmentDto>>();
        var download = await client.GetAsync(uploaded.Url, _ct);
        var forcedDownload = await client.GetAsync(uploaded.Url + "?download=true", _ct);

        // Assert
        Assert.Equal(("screen shot.png", "image/png", Png.Length, true, true), (uploaded.FileName, uploaded.ContentType, uploaded.SizeBytes, uploaded.IsImage, uploaded.CanDelete));
        Assert.Equal($"/api/v1/attachments/{uploaded.Id}", uploaded.Url);
        Assert.Equal(Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(Png)), uploaded.Sha256);
        Assert.Equal([uploaded.Id], list.Select(a => a.Id));
        await download.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal("image/png", download.Content.Headers.ContentType?.MediaType);
        Assert.Equal("inline", download.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal("nosniff", download.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Contains("sandbox", download.Headers.GetValues("Content-Security-Policy").Single(), StringComparison.Ordinal);
        Assert.Equal(Png, await download.Content.ReadAsByteArrayAsync(_ct));
        Assert.Equal("attachment", forcedDownload.Content.Headers.ContentDisposition?.DispositionType);
        var after = await api.WithDbAsync(db => db.Tickets.Where(t => t.Id == world.TicketId).Select(t => t.UpdatedAt).SingleAsync(_ct));
        Assert.True(after > before);
        var actions = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.EntityId == world.TicketId).Select(a => a.Action).ToListAsync(_ct));
        Assert.Contains("attachment.added", actions);
    }

    [Theory]
    [InlineData("notes.txt", "text/plain", "hello", "text/plain")]
    [InlineData("data.csv", "application/vnd.ms-excel", "a,b\r\n1,2", "text/csv")]
    [InlineData("data.json", "application/octet-stream", "{\"a\":1}", "application/json")]
    [InlineData("doc.pdf", "application/pdf", "%PDF-1.7 body", "application/pdf")]
    public async Task Non_images_are_accepted_by_type_or_extension_and_always_download(string name, string declared, string content, string stored)
    {
        // Arrange
        var world = await SeedAsync();
        var client = await api.LoginAsync(world.Member);

        // Act
        var uploaded = await (await UploadAsync(client, "WEB-1", name, declared, Encoding.UTF8.GetBytes(content))).ReadAsync<AttachmentDto>(HttpStatusCode.Created);
        var download = await client.GetAsync(uploaded.Url, _ct);

        // Assert
        Assert.Equal(stored, uploaded.ContentType);
        Assert.Equal("attachment", download.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal(name, download.Content.Headers.ContentDisposition?.FileNameStar ?? download.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
    }

    [Theory]
    [InlineData("fake.png", "image/png", "not really a png", "attachment.type.mismatch")]
    [InlineData("evil.svg", "image/svg+xml", "<svg onload=alert(1)>", "attachment.type.notAllowed")]
    [InlineData("page.html", "text/html", "<html></html>", "attachment.type.notAllowed")]
    [InlineData("tool.exe", "application/octet-stream", "MZ", "attachment.type.notAllowed")]
    [InlineData("bad.json", "application/json", "{ nope", "attachment.type.mismatch")]
    [InlineData("image.txt", "text/plain", "GIF89a....", "attachment.type.mismatch")]
    [InlineData("empty.txt", "text/plain", "", "attachment.size.invalid")]
    public async Task Disallowed_or_mismatching_files_are_rejected(string name, string declared, string content, string code)
    {
        // Arrange
        var world = await SeedAsync();
        var client = await api.LoginAsync(world.Member);

        // Act
        var response = await UploadAsync(client, "WEB-1", name, declared, Encoding.UTF8.GetBytes(content));

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, code);
        Assert.Equal(0, await api.WithDbAsync(db => db.Attachments.CountAsync(_ct)));
    }

    [Fact]
    public async Task Files_over_10_MiB_and_the_51st_attachment_are_rejected()
    {
        // Arrange
        var world = await SeedAsync();
        var client = await api.LoginAsync(world.Member);
        var tooBig = new byte[Attachment.MaxSizeBytes + 1];
        Png.CopyTo(tooBig, 0);
        await api.WithDbAsync(async db =>
        {
            for (var i = 0; i < Attachment.MaxPerTicket; i++)
                db.Attachments.Add(Attachment.Create(world.TicketId, $"f{i}.txt", "text/plain", 1, new string('0', 64), world.Member.Id, DateTimeOffset.UtcNow));
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var big = await UploadAsync(client, "WEB-1", "big.png", "image/png", tooBig);
        var fiftyFirst = await UploadAsync(client, "WEB-1", "one.png", "image/png", Png);

        // Assert
        await big.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "attachment.size.invalid");
        await fiftyFirst.ShouldBeProblemAsync(HttpStatusCode.Conflict, "attachment.limitReached");
    }

    [Fact]
    public async Task Parallel_uploads_never_exceed_the_limit()
    {
        // Arrange
        var world = await SeedAsync();
        var client = await api.LoginAsync(world.Member);
        await api.WithDbAsync(async db =>
        {
            for (var i = 0; i < Attachment.MaxPerTicket - 2; i++)
                db.Attachments.Add(Attachment.Create(world.TicketId, $"f{i}.txt", "text/plain", 1, new string('0', 64), world.Member.Id, DateTimeOffset.UtcNow));
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var responses = await Task.WhenAll(Enumerable.Range(0, 5).Select(i => UploadAsync(client, "WEB-1", $"p{i}.png", "image/png", Png)));

        // Assert
        Assert.Equal(2, responses.Count(r => r.StatusCode == HttpStatusCode.Created));
        Assert.Equal(3, responses.Count(r => r.StatusCode == HttpStatusCode.Conflict));
        Assert.Equal(Attachment.MaxPerTicket, await api.WithDbAsync(db => db.Attachments.CountAsync(_ct)));
    }

    [Fact]
    public async Task Viewers_read_only_tokens_and_outsiders_cannot_upload_and_outsiders_cannot_see()
    {
        // Arrange
        var world = await SeedAsync();
        var uploaded = await (await UploadAsync(await api.LoginAsync(world.Member), "WEB-1", "a.png", "image/png", Png)).ReadAsync<AttachmentDto>(HttpStatusCode.Created);
        var viewer = await api.LoginAsync(world.Viewer);
        var outsider = await api.LoginAsync(world.Outsider);
        var readOnly = await api.CreatePatClientAsync(world.Member, PatScope.ReadOnly);

        // Act
        var viewerUpload = await UploadAsync(viewer, "WEB-1", "b.png", "image/png", Png);
        var viewerList = await (await viewer.GetAsync("/api/v1/tickets/WEB-1/attachments", _ct)).ReadAsync<List<AttachmentDto>>();
        var viewerDownload = await viewer.GetAsync(uploaded.Url, _ct);
        var readOnlyUpload = await UploadAsync(readOnly, "WEB-1", "b.png", "image/png", Png);
        var outsiderUpload = await UploadAsync(outsider, "WEB-1", "b.png", "image/png", Png);
        var outsiderList = await outsider.GetAsync("/api/v1/tickets/WEB-1/attachments", _ct);
        var outsiderDownload = await outsider.GetAsync(uploaded.Url, _ct);
        var outsiderDelete = await outsider.DeleteAsync(uploaded.Url, _ct);

        // Assert
        await viewerUpload.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "project.forbidden");
        Assert.False(Assert.Single(viewerList).CanDelete);
        await viewerDownload.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await readOnlyUpload.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "pat.readOnlyScope");
        await outsiderUpload.ShouldHaveStatusAsync(HttpStatusCode.NotFound);
        await outsiderList.ShouldHaveStatusAsync(HttpStatusCode.NotFound);
        await outsiderDownload.ShouldBeProblemAsync(HttpStatusCode.NotFound, "attachment.notFound");
        await outsiderDelete.ShouldBeProblemAsync(HttpStatusCode.NotFound, "attachment.notFound");
    }

    [Fact]
    public async Task Uploader_and_owner_can_delete_other_members_cannot()
    {
        // Arrange
        var world = await SeedAsync();
        var member = await api.LoginAsync(world.Member);
        var otherMember = await api.LoginAsync(world.OtherMember);
        var owner = await api.LoginAsync(world.Owner);
        var first = await (await UploadAsync(member, "WEB-1", "a.png", "image/png", Png)).ReadAsync<AttachmentDto>(HttpStatusCode.Created);
        var second = await (await UploadAsync(member, "WEB-1", "b.png", "image/png", Png)).ReadAsync<AttachmentDto>(HttpStatusCode.Created);

        // Act
        var byOther = await otherMember.DeleteAsync(first.Url, _ct);
        var otherList = await (await otherMember.GetAsync("/api/v1/tickets/WEB-1/attachments", _ct)).ReadAsync<List<AttachmentDto>>();
        var byUploader = await member.DeleteAsync(first.Url, _ct);
        var byOwner = await owner.DeleteAsync(second.Url, _ct);
        var afterDelete = await member.GetAsync(first.Url, _ct);

        // Assert
        await byOther.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "attachment.forbidden");
        Assert.All(otherList, a => Assert.False(a.CanDelete));
        await byUploader.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await byOwner.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await afterDelete.ShouldHaveStatusAsync(HttpStatusCode.NotFound);
        Assert.Equal(0, await api.WithDbAsync(db => db.Set<Ticketing.Infrastructure.Persistence.AttachmentContent>().CountAsync(_ct)));
        var actions = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.EntityId == world.TicketId).Select(a => a.Action).ToListAsync(_ct));
        Assert.Equal(2, actions.Count(a => a == "attachment.removed"));
    }

    [Fact]
    public async Task Attachments_of_deleted_tickets_and_archived_projects_follow_the_ticket()
    {
        // Arrange
        var world = await SeedAsync();
        var member = await api.LoginAsync(world.Member);
        var uploaded = await (await UploadAsync(member, "WEB-1", "a.png", "image/png", Png)).ReadAsync<AttachmentDto>(HttpStatusCode.Created);
        await api.WithDbAsync(async db =>
        {
            var project = await db.Projects.SingleAsync(p => p.Key == "WEB", _ct);
            project.Archive(world.Owner.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var archivedDownload = await member.GetAsync(uploaded.Url, _ct);
        var archivedDelete = await member.DeleteAsync(uploaded.Url, _ct);
        await api.WithDbAsync(db => db.Tickets.Where(t => t.Id == world.TicketId).ExecuteUpdateAsync(s => s.SetProperty(t => t.DeletedAt, DateTimeOffset.UtcNow), _ct));
        var deletedTicketDownload = await member.GetAsync(uploaded.Url, _ct);

        // Assert
        await archivedDownload.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await archivedDelete.ShouldBeProblemAsync(HttpStatusCode.Conflict, "project.archived");
        await deletedTicketDownload.ShouldBeProblemAsync(HttpStatusCode.NotFound, "attachment.notFound");
    }

    [Fact]
    public async Task Mcp_lists_attachments_and_reads_text_content_but_not_binaries_or_private_files()
    {
        // Arrange
        var world = await SeedAsync();
        var member = await api.LoginAsync(world.Member);
        var json = await (await UploadAsync(member, "WEB-1", "log.json", "application/json", Encoding.UTF8.GetBytes("{\"error\":\"timeout\"}"))).ReadAsync<AttachmentDto>(HttpStatusCode.Created);
        var image = await (await UploadAsync(member, "WEB-1", "a.png", "image/png", Png)).ReadAsync<AttachmentDto>(HttpStatusCode.Created);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Member, PatScope.ReadOnly));
        await using var outsiderMcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Outsider));

        // Act
        var list = await mcp.CallToolAsync("list_attachments", new Dictionary<string, object?> { ["key"] = "WEB-1" }, cancellationToken: _ct);
        var text = await mcp.CallToolAsync("get_attachment_text", new Dictionary<string, object?> { ["attachmentId"] = json.Id }, cancellationToken: _ct);
        var binary = await mcp.CallToolAsync("get_attachment_text", new Dictionary<string, object?> { ["attachmentId"] = image.Id }, cancellationToken: _ct);
        var outsiderText = await outsiderMcp.CallToolAsync("get_attachment_text", new Dictionary<string, object?> { ["attachmentId"] = json.Id }, cancellationToken: _ct);
        var outsiderList = await outsiderMcp.CallToolAsync("list_attachments", new Dictionary<string, object?> { ["key"] = "WEB-1" }, cancellationToken: _ct);

        // Assert
        Assert.Equal(["log.json", "a.png"], Payload(list).EnumerateArray().Select(a => a.GetProperty("fileName").GetString()));
        Assert.Equal(("{\"error\":\"timeout\"}", false), (Payload(text).GetProperty("text").GetString(), Payload(text).GetProperty("truncated").GetBoolean()));
        Assert.True(binary.IsError);
        Assert.Equal("attachment.notText", Payload(binary).GetProperty("code").GetString());
        Assert.Equal("attachment.notFound", Payload(outsiderText).GetProperty("code").GetString());
        Assert.Equal("ticket.notFound", Payload(outsiderList).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Get_attachment_text_truncates_at_200_KB()
    {
        // Arrange
        var world = await SeedAsync();
        var member = await api.LoginAsync(world.Member);
        var big = await (await UploadAsync(member, "WEB-1", "big.txt", "text/plain", Encoding.UTF8.GetBytes(new string('x', 300 * 1024)))).ReadAsync<AttachmentDto>(HttpStatusCode.Created);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Member));

        // Act
        var result = Payload(await mcp.CallToolAsync("get_attachment_text", new Dictionary<string, object?> { ["attachmentId"] = big.Id }, cancellationToken: _ct));

        // Assert
        Assert.True(result.GetProperty("truncated").GetBoolean());
        Assert.Equal(GetAttachmentText.MaxBytes, result.GetProperty("text").GetString()!.Length);
    }

    public static Task<HttpResponseMessage> UploadAsync(HttpClient client, string ticketKey, string fileName, string contentType, byte[] content)
    {
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        form.Add(file, "file", fileName);
        return client.PostAsync($"/api/v1/tickets/{ticketKey}/attachments", form);
    }

    private async Task<World> SeedAsync()
    {
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var otherMember = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", owner, ProjectVisibility.Private,
            (member, ProjectRole.Member), (otherMember, ProjectRole.Member), (viewer, ProjectRole.Viewer));
        var ids = await api.SeedTicketsAsync(web, owner.Id, new SeedTicket("Has screenshots"));
        return new World(owner, member, otherMember, viewer, outsider, ids[0]);
    }

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;

    private sealed record World(TestUser Owner, TestUser Member, TestUser OtherMember, TestUser Viewer, TestUser Outsider, Guid TicketId);
}
