using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Comments;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Comments;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>The comment thread below pages and diagrams (docs refinement D12): ticket comment rules (spec 6.9) on docs.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocCommentTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Members_comment_on_pages_and_diagrams_readers_see_the_thread_oldest_first_and_the_doc_is_left_as_it_was()
    {
        // Arrange
        var world = await SeedAsync("CMT");
        var page = await world.Owner.CreatePageAsync("CMT", "Design", content: "# Design");
        var diagram = await world.Owner.CreateDocAsync("CMT", new { kind = "Diagram", diagramFormat = "Mermaid", title = "Flow", content = "flowchart LR\n  a --> b" });

        // Act
        var first = await world.Member.AddDocCommentAsync(page.Key, "Looks good, see CMT-D-2.");
        var second = await world.Owner.AddDocCommentAsync(page.Key, "**Thanks**");
        var onDiagram = await world.Member.AddDocCommentAsync(diagram.Key, "Arrow is wrong");
        var thread = await world.Viewer.DocCommentsAsync(page.Key);
        var doc = await world.Viewer.GetDocAsync(page.Key);

        // Assert
        Assert.Equal((page.Key, "Looks good, see CMT-D-2.", true, true, false), (first.DocKey, first.Body, first.CanEdit, first.CanDelete, first.Deleted));
        Assert.Equal(world.MemberUser.Email, first.Author.Email);
        Assert.Equal(diagram.Key, onDiagram.DocKey);
        Assert.Equal([first.Id, second.Id], thread.Items.Select(c => c.Id));
        Assert.All(thread.Items, c => Assert.Equal((false, false), (c.CanEdit, c.CanDelete)));
        Assert.Null(thread.NextCursor);
        Assert.Equal((2, page.Version, page.UpdatedAt, page.RowVersion), (doc.CommentCount, doc.Version, doc.UpdatedAt, doc.RowVersion));
        var activity = await api.WithDbAsync(db => db.ActivityEntries
            .Where(a => a.EntityId == page.Id && a.Action == AddDocComment.Action)
            .Select(a => new { a.EntityType, a.NewValue })
            .ToListAsync(_ct));
        Assert.Equal(2, activity.Count);
        Assert.All(activity, a => Assert.Equal(ActivityEntityType.Doc, a.EntityType));
        Assert.Contains(first.Id.ToString(), activity[0].NewValue + activity[1].NewValue, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_thread_pages_with_a_cursor()
    {
        // Arrange
        var world = await SeedAsync("PAGED");
        var page = await world.Owner.CreatePageAsync("PAGED", "Long thread");
        for (var i = 1; i <= 3; i++)
            await world.Member.AddDocCommentAsync(page.Key, $"Comment {i}");

        // Act
        var firstPage = await world.Viewer.DocCommentsAsync(page.Key, "?limit=2");
        var secondPage = await world.Viewer.DocCommentsAsync(page.Key, $"?limit=2&cursor={firstPage.NextCursor}");

        // Assert
        Assert.Equal(["Comment 1", "Comment 2"], firstPage.Items.Select(c => c.Body));
        Assert.Equal(["Comment 3"], secondPage.Items.Select(c => c.Body));
        Assert.Null(secondPage.NextCursor);
    }

    [Fact]
    public async Task Folders_have_no_comments()
    {
        // Arrange
        var world = await SeedAsync("FOLD");
        var folder = await world.Owner.CreateFolderAsync("FOLD", "Folder");

        // Act
        var list = await world.Viewer.DocCommentsAsync(folder.Key);
        var add = await world.Member.PostDocCommentAsync(folder.Key, "Hello");

        // Assert
        Assert.Empty(list.Items);
        await add.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.KindUnsupported);
        Assert.Equal(0, await api.WithDbAsync(db => db.Comments.CountAsync(_ct)));
    }

    [Fact]
    public async Task Authors_edit_their_own_comments_and_the_previous_body_goes_to_the_doc_activity()
    {
        // Arrange
        var world = await SeedAsync("EDIT");
        var page = await world.Owner.CreatePageAsync("EDIT", "Page");
        var comment = await world.Member.AddDocCommentAsync(page.Key, "Frist");

        // Act
        var edited = await (await world.Member.PatchDocCommentAsync(comment.Id, "First")).ReadAsync<DocCommentDto>();
        var byOwner = await world.Owner.PatchDocCommentAsync(comment.Id, "Owner edit");
        var empty = await world.Member.PatchDocCommentAsync(comment.Id, " ");

        // Assert
        Assert.Equal("First", edited.Body);
        Assert.NotNull(edited.EditedAt);
        await byOwner.ShouldBeProblemAsync(HttpStatusCode.Forbidden, CommentErrors.NotAuthor);
        await empty.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.Validation);
        var entry = await api.WithDbAsync(db => db.ActivityEntries.SingleAsync(a => a.EntityId == page.Id && a.Action == UpdateDocComment.Action, _ct));
        Assert.Equal((ActivityEntityType.Doc, "comment"), (entry.EntityType, entry.Field));
        Assert.Contains("Frist", entry.OldValue, StringComparison.Ordinal);
        Assert.DoesNotContain("First", entry.NewValue ?? string.Empty, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Authors_delete_their_own_comments_owners_delete_any_and_a_placeholder_stays()
    {
        // Arrange
        var world = await SeedAsync("DELC");
        var page = await world.Owner.CreatePageAsync("DELC", "Page");
        var mine = await world.Member.AddDocCommentAsync(page.Key, "Mine");
        var theirs = await world.OtherMember.AddDocCommentAsync(page.Key, "Theirs");
        var kept = await world.OtherMember.AddDocCommentAsync(page.Key, "Kept");

        // Act
        var byOther = await world.Member.DeleteDocCommentAsync(theirs.Id);
        var byAuthor = await (await world.Member.DeleteDocCommentAsync(mine.Id)).ReadAsync<DocCommentDto>();
        var byOwner = await (await world.Owner.DeleteDocCommentAsync(theirs.Id)).ReadAsync<DocCommentDto>();
        var again = await (await world.Member.DeleteDocCommentAsync(mine.Id)).ReadAsync<DocCommentDto>();
        var editDeleted = await world.Member.PatchDocCommentAsync(mine.Id, "Back");
        var thread = await world.Viewer.DocCommentsAsync(page.Key);
        var doc = await world.Viewer.GetDocAsync(page.Key);

        // Assert
        await byOther.ShouldBeProblemAsync(HttpStatusCode.Forbidden, CommentErrors.NotAuthor);
        Assert.Equal((true, string.Empty, false, false), (byAuthor.Deleted, byAuthor.Body, byAuthor.CanEdit, byAuthor.CanDelete));
        Assert.True(byOwner.Deleted);
        Assert.Equal(byAuthor.DeletedAt, again.DeletedAt);
        await editDeleted.ShouldBeProblemAsync(HttpStatusCode.Conflict, CommentErrors.Deleted);
        Assert.Equal([(mine.Id, true), (theirs.Id, true), (kept.Id, false)], thread.Items.Select(c => (c.Id, c.Deleted)));
        Assert.Equal(1, doc.CommentCount);
        Assert.Equal(2, await api.WithDbAsync(db => db.ActivityEntries.CountAsync(a => a.EntityId == page.Id && a.Action == DeleteDocComment.Action, _ct)));
    }

    [Fact]
    public async Task Viewers_and_read_only_tokens_cannot_comment_but_anyone_signed_in_can_on_a_public_project()
    {
        // Arrange
        var world = await SeedAsync("VIEWC");
        var page = await world.Owner.CreatePageAsync("VIEWC", "Page");
        var comment = await world.Member.AddDocCommentAsync(page.Key, "Hello");
        var readOnly = await api.CreatePatClientAsync(world.MemberUser, PatScope.ReadOnly);
        await world.Owner.CreateProjectAsync("OPENC", ProjectVisibility.Public);
        var publicPage = await world.Owner.CreatePageAsync("OPENC", "Public page");
        var stranger = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var byViewer = await world.Viewer.PostDocCommentAsync(page.Key, "Hi");
        var byToken = await readOnly.PostDocCommentAsync(page.Key, "Hi");
        var editByToken = await readOnly.PatchDocCommentAsync(comment.Id, "Edited");
        var listByToken = await readOnly.DocCommentsAsync(page.Key);
        var byStranger = await (await stranger.PostDocCommentAsync(publicPage.Key, "Hi")).ReadAsync<DocCommentDto>(HttpStatusCode.Created);

        // Assert
        await byViewer.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await byToken.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
        await editByToken.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
        Assert.False(Assert.Single(listByToken.Items).CanEdit);
        Assert.True(byStranger.CanEdit);
    }

    [Fact]
    public async Task The_tree_and_folder_children_count_the_comments_that_are_not_deleted()
    {
        // Arrange
        var world = await SeedAsync("TREEC");
        var other = await SeedAsync("TREEX");
        var folder = await world.Owner.CreateFolderAsync("TREEC", "Specs");
        var page = await world.Owner.CreatePageAsync("TREEC", "Design", parent: folder.Key);
        var diagram = await world.Owner.CreateDocAsync("TREEC", new { kind = "Diagram", diagramFormat = "Mermaid", title = "Flow", parent = folder.Key, content = "flowchart LR\n  a --> b" });
        var quiet = await world.Owner.CreatePageAsync("TREEC", "Quiet");
        await world.Member.AddDocCommentAsync(page.Key, "One");
        await world.Member.AddDocCommentAsync(page.Key, "Two");
        var removed = await world.Member.AddDocCommentAsync(page.Key, "Gone");
        (await world.Member.DeleteDocCommentAsync(removed.Id)).EnsureSuccessStatusCode();
        await world.Owner.AddDocCommentAsync(diagram.Key, "Arrow");
        var elsewhere = await other.Owner.CreatePageAsync("TREEX", "Design");
        await other.Member.AddDocCommentAsync(elsewhere.Key, "Other project");

        // Act
        var tree = await world.Viewer.GetTreeAsync("TREEC");
        var children = (await world.Viewer.GetDocAsync(folder.Key)).Children!;

        // Assert
        Assert.Equal(
            [(folder.Key, 0), (page.Key, 2), (diagram.Key, 1), (quiet.Key, 0)],
            tree.Items.Select(i => (i.Key, i.CommentCount)));
        Assert.Equal([(page.Key, 2), (diagram.Key, 1)], children.Select(i => (i.Key, i.CommentCount)));
    }

    [Fact]
    public async Task Archived_projects_keep_comments_readable_but_refuse_writes()
    {
        // Arrange
        var world = await SeedAsync("ARCC");
        var page = await world.Owner.CreatePageAsync("ARCC", "Page");
        var comment = await world.Member.AddDocCommentAsync(page.Key, "Hello");
        (await world.Owner.PostAsync("/api/v1/projects/ARCC/archive", null, _ct)).EnsureSuccessStatusCode();

        // Act
        var list = await world.Member.DocCommentsAsync(page.Key);
        var add = await world.Member.PostDocCommentAsync(page.Key, "Again");
        var edit = await world.Member.PatchDocCommentAsync(comment.Id, "Edited");
        var delete = await world.Owner.DeleteDocCommentAsync(comment.Id);

        // Assert
        Assert.Equal((false, false), (list.Items[0].CanEdit, list.Items[0].CanDelete));
        await add.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
        await edit.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
        await delete.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
    }

    [Fact]
    public async Task Comments_follow_the_doc_through_delete_and_restore()
    {
        // Arrange
        var world = await SeedAsync("GONEC");
        var page = await world.Member.CreatePageAsync("GONEC", "Page");
        var comment = await world.Member.AddDocCommentAsync(page.Key, "Hello");
        (await world.Member.DeleteAsync($"/api/v1/docs/{page.Key}", _ct)).EnsureSuccessStatusCode();

        // Act
        var listWhileDeleted = await world.Member.GetAsync($"/api/v1/docs/{page.Key}/comments", _ct);
        var addWhileDeleted = await world.Member.PostDocCommentAsync(page.Key, "Again");
        var editWhileDeleted = await world.Member.PatchDocCommentAsync(comment.Id, "Edited");
        (await world.Member.PostAsync($"/api/v1/docs/{page.Key}/restore", null, _ct)).EnsureSuccessStatusCode();
        var restored = await world.Member.DocCommentsAsync(page.Key);

        // Assert
        await listWhileDeleted.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.Deleted);
        await addWhileDeleted.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.Deleted);
        await editWhileDeleted.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.Deleted);
        Assert.Equal(("Hello", true), (Assert.Single(restored.Items).Body, restored.Items[0].CanEdit));
    }

    [Fact]
    public async Task Ticket_and_doc_comment_endpoints_never_reach_each_others_comments()
    {
        // Arrange
        var world = await SeedAsync("MIX");
        var page = await world.Owner.CreatePageAsync("MIX", "Page");
        var docComment = await world.Member.AddDocCommentAsync(page.Key, "On the doc");
        var ticket = await world.Owner.CreateTicketAsync("MIX", "Ticket");
        var ticketComment = await (await world.Member.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/comments", new { body = "On the ticket" }, HttpAssertions.Json, _ct))
            .ReadAsync<Ticketing.Application.Tickets.CommentDto>(HttpStatusCode.Created);

        // Act
        var ticketEdit = await world.Member.PatchAsJsonAsync($"/api/v1/comments/{docComment.Id}", new { body = "x" }, HttpAssertions.Json, _ct);
        var ticketDelete = await world.Member.DeleteAsync($"/api/v1/comments/{docComment.Id}", _ct);
        var docEdit = await world.Member.PatchDocCommentAsync(ticketComment.Id, "x");
        var docDelete = await world.Member.DeleteDocCommentAsync(ticketComment.Id);
        var ticketThread = await (await world.Member.GetAsync($"/api/v1/tickets/{ticket.Key}/comments", _ct))
            .ReadAsync<CursorPage<Ticketing.Application.Tickets.CommentDto>>();
        var docThread = await world.Member.DocCommentsAsync(page.Key);

        // Assert
        await ticketEdit.ShouldBeProblemAsync(HttpStatusCode.NotFound, CommentErrors.NotFound);
        await ticketDelete.ShouldBeProblemAsync(HttpStatusCode.NotFound, CommentErrors.NotFound);
        await docEdit.ShouldBeProblemAsync(HttpStatusCode.NotFound, CommentErrors.NotFound);
        await docDelete.ShouldBeProblemAsync(HttpStatusCode.NotFound, CommentErrors.NotFound);
        Assert.Equal([ticketComment.Id], ticketThread.Items.Select(c => c.Id));
        Assert.Equal([docComment.Id], docThread.Items.Select(c => c.Id));
    }

    [Fact]
    public async Task An_llm_discusses_a_page_through_the_doc_comment_tools()
    {
        // Arrange
        var world = await SeedAsync("MCPC");
        var page = await world.Owner.CreatePageAsync("MCPC", "Runbook");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.MemberUser));

        // Act
        var added = await CallAsync(mcp, "add_doc_comment", new() { ["docKey"] = page.Key, ["body"] = "Step 3 is outdated." });
        var id = added.GetProperty("id").GetGuid();
        var updated = await CallAsync(mcp, "update_doc_comment", new() { ["commentId"] = id, ["body"] = "Step 3 needs the new port." });
        var listed = await CallAsync(mcp, "list_doc_comments", new() { ["docKey"] = page.Key });
        var deleted = await CallAsync(mcp, "delete_doc_comment", new() { ["commentId"] = id });
        var onFolder = await mcp.CallToolAsync(
            "add_doc_comment", new Dictionary<string, object?> { ["docKey"] = (await world.Owner.CreateFolderAsync("MCPC", "F")).Key, ["body"] = "x" }, cancellationToken: _ct);

        // Assert
        Assert.Equal(page.Key, added.GetProperty("docKey").GetString());
        Assert.Equal("Step 3 needs the new port.", updated.GetProperty("body").GetString());
        Assert.Equal(id, listed.GetProperty("items")[0].GetProperty("id").GetGuid());
        Assert.True(deleted.GetProperty("deleted").GetBoolean());
        Assert.True(onFolder.IsError);
        Assert.Equal(DocErrors.KindUnsupported, Payload(onFolder).GetProperty("code").GetString());
        Assert.Equal(WriteChannel.Mcp, await api.WithDbAsync(db => db.ActivityEntries
            .Where(a => a.EntityId == page.Id && a.Action == AddDocComment.Action).Select(a => a.Channel).SingleAsync(_ct)));
    }

    [Fact]
    public async Task Read_only_tokens_see_only_list_doc_comments_and_delete_is_destructive()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await using var readOnly = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));
        await using var readWrite = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadWrite));
        string[] tools = ["list_doc_comments", "add_doc_comment", "update_doc_comment", "delete_doc_comment"];

        // Act
        var readOnlyTools = (await readOnly.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).Intersect(tools).ToList();
        var readWriteTools = (await readWrite.ListToolsAsync(cancellationToken: _ct)).Where(t => tools.Contains(t.Name)).ToList();

        // Assert
        Assert.Equal(["list_doc_comments"], readOnlyTools);
        Assert.Equal(tools.Order(), readWriteTools.Select(t => t.Name).Order());
        Assert.True(readWriteTools.Single(t => t.Name == "delete_doc_comment").ProtocolTool.Annotations?.DestructiveHint);
        Assert.True(readWriteTools.Single(t => t.Name == "list_doc_comments").ProtocolTool.Annotations?.ReadOnlyHint);
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        var payload = Payload(result);
        Assert.True(result.IsError != true, $"{tool} failed: {payload}");
        return payload;
    }

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;

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
        return new World(owner, await api.LoginAsync(memberUser), await api.LoginAsync(otherMemberUser), await api.LoginAsync(viewerUser), memberUser);
    }

    private sealed record World(HttpClient Owner, HttpClient Member, HttpClient OtherMember, HttpClient Viewer, TestUser MemberUser);
}
