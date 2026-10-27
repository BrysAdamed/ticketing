using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Docs;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Ordering;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

[Collection(nameof(DocsCollection))]
public sealed class DocTreeTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Creates_folders_pages_and_diagrams_in_manual_order_with_project_keys()
    {
        // Arrange
        var client = await SignedInAsync();
        await client.CreateProjectAsync("DOC");

        // Act
        var architecture = await client.CreateFolderAsync("DOC", "Architecture");
        var intro = await client.CreatePageAsync("DOC", "Intro", content: "# Hello\r\nWorld");
        var adr1 = await client.CreatePageAsync("DOC", "ADR 1", architecture.Key);
        var top = await client.CreateDocAsync("DOC", new { kind = "Page", title = "Top page", position = "Top" });
        var adr0 = await client.CreateDocAsync("DOC", new { kind = "Page", title = "ADR 0", parent = "architecture", beforeKey = adr1.Key });
        var flow = await client.CreateDocAsync("DOC", new
        {
            kind = "Diagram", title = "Flow", diagramFormat = "Mermaid", parent = architecture.Key, afterKey = adr1.Key, content = "flowchart LR\n  A --> B",
        });
        var tree = await client.GetTreeAsync("DOC");

        // Assert
        Assert.Equal(["DOC-D-1", "DOC-D-2", "DOC-D-3", "DOC-D-4", "DOC-D-5", "DOC-D-6"], new[] { architecture, intro, adr1, top, adr0, flow }.Select(d => d.Key));
        Assert.Equal(["Top page", "Architecture", ">ADR 0", ">ADR 1", ">Flow", "Intro"], tree.Titles());
        Assert.Equal((0, 1), (architecture.Version, intro.Version));
        Assert.Equal("# Hello\nWorld", intro.Content);
        Assert.Null(architecture.Content);
        Assert.Equal(("Architecture/ADR 1", "DOC-D-1"), (adr1.Path, adr1.ParentKey));
        Assert.Equal([new DocCrumbDto("DOC-D-1", "Architecture")], adr1.Breadcrumb);
        Assert.Equal(DiagramFormat.Mermaid, flow.DiagramFormat);
        Assert.Equal("/p/DOC/docs/DOC-D-3/adr-1", adr1.Url);
        Assert.Equal(3, tree.Items.Single(i => i.Key == "DOC-D-1").ChildCount);
        var folder = await client.GetDocAsync("doc-d-1");
        Assert.Equal(["ADR 0", "ADR 1", "Flow"], folder.Children!.Select(c => c.Title));
        var versions = await api.WithDbAsync(db => db.DocVersions.CountAsync(_ct));
        var created = await api.WithDbAsync(db => db.ActivityEntries.CountAsync(a => a.EntityType == ActivityEntityType.Doc && a.Action == CreateDoc.Action, _ct));
        Assert.Equal((5, 6), (versions, created));
    }

    [Fact]
    public async Task Twenty_parallel_creates_get_distinct_keys_and_ranks()
    {
        // Arrange
        var client = await SignedInAsync();
        var project = await client.CreateProjectAsync("PAR");

        // Act
        var created = await Task.WhenAll(Enumerable.Range(1, 20).Select(i => client.CreatePageAsync("PAR", $"Page {i}")));

        // Assert
        Assert.Equal(20, created.Select(d => d.Key).Distinct().Count());
        var ranks = await api.WithDbAsync(db => db.DocNodes.Where(n => n.ProjectId == project.Id).Select(n => n.Rank).ToListAsync(_ct));
        Assert.Equal(20, ranks.Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(Enumerable.Range(1, 20), created.Select(d => int.Parse(d.Key[6..], System.Globalization.CultureInfo.InvariantCulture)).Order());
    }

    [Fact]
    public async Task Paths_resolve_case_insensitively_with_escaped_slashes()
    {
        // Arrange
        var client = await SignedInAsync();
        await client.CreateProjectAsync("PTH");
        var folder = await client.CreateFolderAsync("PTH", "Q1/Q2 plans");
        var page = await client.CreatePageAsync("PTH", "Road map", folder.Key);

        // Act
        var byPath = await (await client.GetAsync($"/api/v1/projects/PTH/docs/by-path?path={Uri.EscapeDataString(@"q1\/q2 PLANS/road MAP")}", _ct)).ReadAsync<DocDto>();
        var missing = await client.GetAsync("/api/v1/projects/PTH/docs/by-path?path=Q1/Q2%20plans/Road%20map", _ct);
        var underFolder = await client.CreatePageAsync("PTH", "Child", @"Q1\/Q2 plans");

        // Assert
        Assert.Equal(page.Key, byPath.Key);
        Assert.Equal(@"Q1\/Q2 plans/Road map", byPath.Path);
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.NotFound);
        Assert.Equal(folder.Key, underFolder.ParentKey);
    }

    [Fact]
    public async Task Sibling_titles_are_unique_ignoring_case_but_free_in_other_folders_and_after_delete()
    {
        // Arrange
        var client = await SignedInAsync();
        await client.CreateProjectAsync("TTL");
        var folder = await client.CreateFolderAsync("TTL", "Folder");
        var notes = await client.CreatePageAsync("TTL", "Notes");

        // Act
        var duplicate = await client.PostAsJsonAsync("/api/v1/projects/TTL/docs", new { kind = "Folder", title = "NOTES" }, _ct);
        var elsewhere = await client.CreatePageAsync("TTL", "notes", folder.Key);
        var moveClash = await client.MoveDocAsync(elsewhere.Key, new { parent = "root" });
        var renameClash = await client.PatchDocAsync(notes.Key, new { title = "folder" });
        var renameCase = await client.PatchDocAsync(notes.Key, new { title = "NOTES" });
        (await client.DeleteAsync($"/api/v1/docs/{notes.Key}", _ct)).EnsureSuccessStatusCode();
        var reused = await client.CreatePageAsync("TTL", "Notes");

        // Assert
        await duplicate.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.TitleDuplicate);
        Assert.Equal("Folder/notes", elsewhere.Path);
        await moveClash.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.TitleDuplicate);
        await renameClash.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.TitleDuplicate);
        Assert.Equal("NOTES", (await renameCase.ReadAsync<DocDto>()).Title);
        Assert.Equal("Notes", reused.Title);
    }

    [Fact]
    public async Task Tree_is_at_most_six_levels_deep()
    {
        // Arrange
        var client = await SignedInAsync();
        await client.CreateProjectAsync("DEP");
        string? parent = null;
        for (var level = 1; level <= 5; level++)
            parent = (await client.CreateFolderAsync("DEP", $"Level {level}", parent)).Key;

        // Act
        var sixth = await client.CreatePageAsync("DEP", "Leaf at 6", parent);
        var sixthFolder = await client.CreateFolderAsync("DEP", "Folder at 6", parent);
        var seventh = await client.PostAsJsonAsync("/api/v1/projects/DEP/docs", new { kind = "Page", title = "Too deep", parent = sixthFolder.Key }, _ct);

        // Assert
        Assert.Equal("Level 1/Level 2/Level 3/Level 4/Level 5/Leaf at 6", sixth.Path);
        await seventh.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.TreeDepth);
    }

    [Fact]
    public async Task Folders_hold_at_most_500_docs_and_projects_5000()
    {
        // Arrange
        var (client, owner) = await SignedInWithUserAsync();
        var full = await client.CreateProjectAsync("FUL");
        var folder = await client.CreateFolderAsync("FUL", "Full folder");
        await api.PagesAsync(full.Id, folder.Id, owner.Id, 500);
        var big = await client.CreateProjectAsync("BIG");
        await api.PagesAsync(big.Id, null, owner.Id, 5_000);

        // Act
        var intoFull = await client.PostAsJsonAsync("/api/v1/projects/FUL/docs", new { kind = "Page", title = "One more", parent = folder.Key }, _ct);
        var atRoot = await client.CreatePageAsync("FUL", "Root is fine");
        var moveIntoFull = await client.MoveDocAsync(atRoot.Key, new { parent = folder.Key });
        var overProject = await client.PostAsJsonAsync("/api/v1/projects/BIG/docs", new { kind = "Folder", title = "One more" }, _ct);

        // Assert
        await intoFull.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.FolderFull);
        await moveIntoFull.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.FolderFull);
        await overProject.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.ProjectLimit);
    }

    [Fact]
    public async Task Move_rejects_cycles_depth_and_title_clashes_and_records_parent_changes_only()
    {
        // Arrange
        var client = await SignedInAsync();
        await client.CreateProjectAsync("MOV");
        var a = await client.CreateFolderAsync("MOV", "A");
        var b = await client.CreateFolderAsync("MOV", "B", a.Key);
        var c = await client.CreateFolderAsync("MOV", "C", b.Key);
        var deep = await client.CreateFolderAsync("MOV", "D1");
        string parent = deep.Key;
        for (var level = 2; level <= 4; level++)
            parent = (await client.CreateFolderAsync("MOV", $"D{level}", parent)).Key;
        var page = await client.CreatePageAsync("MOV", "B");
        var other = await client.CreatePageAsync("MOV", "Other");

        // Act
        var cycle = await client.MoveDocAsync(a.Key, new { parent = c.Key });
        var self = await client.MoveDocAsync(a.Key, new { parent = a.Key });
        var tooDeep = await client.MoveDocAsync(a.Key, new { parent });
        var clash = await client.MoveDocAsync(page.Key, new { parent = a.Key });
        var reorder = await client.MoveDocAsync(other.Key, new { position = "Top" });
        var moved = await (await client.MoveDocAsync(page.Key, new { parent = c.Key })).ReadAsync<DocDto>();

        // Assert
        await cycle.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.TreeCycle);
        await self.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.TreeCycle);
        await tooDeep.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.TreeDepth);
        await clash.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.TitleDuplicate);
        await reorder.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal("A/B/C/B", moved.Path);
        Assert.Equal("Other", (await client.GetTreeAsync("MOV")).Items[0].Title);
        var moves = await api.WithDbAsync(db => db.ActivityEntries.Where(e => e.Action == MoveDoc.Action).Select(e => new { e.OldValue, e.NewValue }).ToListAsync(_ct));
        var single = Assert.Single(moves);
        Assert.Equal(("null", $"\"{c.Key}\""), (single.OldValue ?? "null", single.NewValue));
    }

    [Fact]
    public async Task Placing_between_crowded_siblings_rebalances_the_folder()
    {
        // Arrange
        var client = await SignedInAsync();
        var project = await client.CreateProjectAsync("RBL");
        var low = await client.CreatePageAsync("RBL", "Low");
        var high = await client.CreatePageAsync("RBL", "High");
        var moving = await client.CreatePageAsync("RBL", "Moving");
        var lowRank = "a0" + new string('V', 70);
        await api.WithDbAsync(db => db.Database.ExecuteSqlAsync(
            $"UPDATE doc_nodes SET rank = CASE id WHEN {low.Id} THEN {lowRank} WHEN {high.Id} THEN {lowRank + "V"} ELSE 'b0' END WHERE project_id = {project.Id}", _ct));

        // Act
        var response = await client.MoveDocAsync(moving.Key, new { afterKey = low.Key });

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(["Low", "Moving", "High"], (await client.GetTreeAsync("RBL")).Titles());
        var ranks = await api.WithDbAsync(db => db.DocNodes.Where(n => n.ProjectId == project.Id).Select(n => n.Rank).ToListAsync(_ct));
        Assert.All(ranks, r => Assert.True(r.Length <= Ranks.RebalanceThreshold));
    }

    [Fact]
    public async Task Anchors_must_be_siblings_in_the_target_folder()
    {
        // Arrange
        var client = await SignedInAsync();
        await client.CreateProjectAsync("ANC");
        var folder = await client.CreateFolderAsync("ANC", "Folder");
        var inside = await client.CreatePageAsync("ANC", "Inside", folder.Key);

        // Act
        var create = await client.PostAsJsonAsync("/api/v1/projects/ANC/docs", new { kind = "Page", title = "Root page", afterKey = inside.Key }, _ct);
        var both = await client.PostAsJsonAsync("/api/v1/projects/ANC/docs", new { kind = "Page", title = "X", position = "Top", afterKey = inside.Key }, _ct);

        // Assert
        await create.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.RankAnchorInvalid);
        await both.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
    }

    [Fact]
    public async Task Duplicate_copies_latest_content_next_to_the_original_with_a_free_title()
    {
        // Arrange
        var client = await SignedInAsync();
        await client.CreateProjectAsync("DUP");
        var folder = await client.CreateFolderAsync("DUP", "Folder");
        var original = await client.CreatePageAsync("DUP", "Spec", content: "v1");
        await (await client.PatchDocAsync(original.Key, new { content = "v2", baseVersion = 1 })).ReadAsync<DocDto>();
        var last = await client.CreatePageAsync("DUP", "Last");

        // Act
        var first = await (await client.PostAsync($"/api/v1/docs/{original.Key}/duplicate", null, _ct)).ReadAsync<DocDto>(HttpStatusCode.Created);
        var second = await (await client.PostAsync($"/api/v1/docs/{original.Key}/duplicate", null, _ct)).ReadAsync<DocDto>(HttpStatusCode.Created);
        var ofFolder = await client.PostAsync($"/api/v1/docs/{folder.Key}/duplicate", null, _ct);

        // Assert
        Assert.Equal(("Copy of Spec", "v2", 1), (first.Title, first.Content, first.Version));
        Assert.Equal("Copy of Spec (2)", second.Title);
        Assert.Equal(["Folder", "Spec", "Copy of Spec (2)", "Copy of Spec", "Last"], (await client.GetTreeAsync("DUP")).Titles());
        Assert.Equal("Last", last.Title);
        await ofFolder.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.KindUnsupported);
    }

    [Fact]
    public async Task Recent_lists_pages_and_diagrams_newest_first_without_folders_or_deleted_docs()
    {
        // Arrange
        var client = await SignedInAsync();
        await client.CreateProjectAsync("REC");
        var folder = await client.CreateFolderAsync("REC", "Folder");
        var older = await client.CreatePageAsync("REC", "Older", folder.Key);
        var gone = await client.CreatePageAsync("REC", "Gone");
        var newer = await client.CreatePageAsync("REC", "Newer");
        (await client.DeleteAsync($"/api/v1/docs/{gone.Key}", _ct)).EnsureSuccessStatusCode();
        await (await client.PatchDocAsync(older.Key, new { content = "edited", baseVersion = 1 })).ReadAsync<DocDto>();

        // Act
        var recent = await (await client.GetAsync("/api/v1/projects/REC/docs/recent?limit=5", _ct)).ReadAsync<List<DocSummaryDto>>();

        // Assert
        Assert.Equal([older.Key, newer.Key], recent.Select(r => r.Key));
        Assert.Equal("Folder/Older", recent[0].Path);
        Assert.Equal(2, recent[0].Version);
    }

    private async Task<HttpClient> SignedInAsync() => (await SignedInWithUserAsync()).Client;

    private async Task<(HttpClient Client, TestUser User)> SignedInWithUserAsync()
    {
        var user = await api.CreateUserAsync();
        return (await api.LoginAsync(user), user);
    }
}
