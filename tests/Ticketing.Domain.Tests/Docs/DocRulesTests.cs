using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Domain.Tests.Docs;

public sealed class DocRulesTests
{
    [Theory]
    [InlineData("Architecture/ADRs/0001", new[] { "Architecture", "ADRs", "0001" })]
    [InlineData(@"/Q1\/Q2 plans/ Road map /", new[] { "Q1/Q2 plans", "Road map" })]
    [InlineData(@"C:\\temp", new[] { @"C:\temp" })]
    public void Paths_split_on_unescaped_slashes(string path, string[] expected) =>
        Assert.Equal(expected, DocPaths.Parse(path));

    [Theory]
    [InlineData("")]
    [InlineData("a//b")]
    [InlineData(@"dangling\")]
    [InlineData(@"bad\escape")]
    public void Malformed_paths_resolve_to_nothing(string path) => Assert.Null(DocPaths.Parse(path));

    [Fact]
    public void Formatting_escapes_slashes_and_backslashes_so_paths_round_trip()
    {
        // Act
        var path = DocPaths.Format(["Q1/Q2", @"a\b", "Plain"]);

        // Assert
        Assert.Equal(@"Q1\/Q2/a\\b/Plain", path);
        Assert.Equal(["Q1/Q2", @"a\b", "Plain"], DocPaths.Parse(path));
    }

    [Theory]
    [InlineData("0001 Use Postgres!", "0001-use-postgres")]
    [InlineData("Café déjà vu", "cafe-deja-vu")]
    [InlineData("???", "doc")]
    public void Slugs_are_lower_case_ascii_words(string title, string slug) => Assert.Equal(slug, DocPaths.Slug(title));

    [Theory]
    [InlineData("Q1/Q2: plans?", "Q1 Q2 plans.md")]
    [InlineData("Release \"notes\" <draft>", "Release notes draft.md")]
    [InlineData("Café déjà vu", "Café déjà vu.md")]
    [InlineData("/:*?|", "WEB-D-7.md")]
    [InlineData("...", "WEB-D-7.md")]
    public void File_names_drop_reserved_characters_and_fall_back_to_the_key(string title, string expected) =>
        Assert.Equal(expected, DocTitles.FileName(title, "WEB-D-7", ".md"));

    [Fact]
    public void Copy_and_restored_titles_avoid_taken_ones_ignoring_case()
    {
        // Arrange
        var taken = new HashSet<string>(["copy of spec", "Copy of Spec (2)", "Notes", "notes (restored)"], DocTitles.Comparer);

        // Act + Assert
        Assert.Equal("Copy of Spec (3)", DocTitles.CopyOf("Spec", taken));
        Assert.Equal("Copy of Other", DocTitles.CopyOf("Other", taken));
        Assert.Equal("Notes (restored 2)", DocTitles.Restored("Notes", taken));
        Assert.Equal("Free", DocTitles.Restored("Free", taken));
        Assert.Equal(DocNode.TitleMaxLength, DocTitles.CopyOf(new string('x', DocNode.TitleMaxLength), taken).Length);
    }

    [Fact]
    public void Edits_apply_in_order_and_fail_whole_on_no_match_or_ambiguity()
    {
        // Act
        var edited = DocEdits.Apply("a b\nb c", [new DocEdit("b", "B", ReplaceAll: true), new DocEdit("a B\r\nB", "x")]);
        var noMatch = Assert.Throws<DomainException>(() => DocEdits.Apply("abc", [new DocEdit("a", "z"), new DocEdit("a", "y")]));
        var ambiguous = Assert.Throws<DomainException>(() => DocEdits.Apply("aa", [new DocEdit("a", "b")]));
        var empty = Assert.Throws<DomainException>(() => DocEdits.Apply("aa", [new DocEdit("", "b")]));

        // Assert
        Assert.Equal("x c", edited);
        Assert.Equal((DocErrors.EditNoMatch, "Edit 2: oldText was not found in the latest version."), (noMatch.Code, noMatch.Message));
        Assert.Equal(DocErrors.EditAmbiguous, ambiguous.Code);
        Assert.Equal("edits[0].oldText", empty.Field);
    }

    [Fact]
    public void Tree_shape_enforces_depth_cycles_and_folder_room()
    {
        // Arrange
        var ids = Enumerable.Range(0, 7).Select(_ => Guid.CreateVersion7()).ToArray();
        var nodes = new List<DocTreeNode> { new(ids[0], null, DocKind.Folder) };
        for (var i = 1; i < 5; i++)
            nodes.Add(new DocTreeNode(ids[i], ids[i - 1], DocKind.Folder));
        nodes.Add(new DocTreeNode(ids[5], null, DocKind.Folder));
        nodes.Add(new DocTreeNode(ids[6], ids[5], DocKind.Page));
        var shape = new DocTreeShape(nodes);

        // Act + Assert
        Assert.Equal(6, shape.DepthUnder(ids[4]));
        Assert.Equal(5, shape.HeightOf(ids[0]));
        Assert.Equal([ids[1], ids[2], ids[3], ids[4]], shape.DescendantsOf(ids[0]));
        shape.EnsureCanAdd(ids[4]);
        Assert.Equal(DocErrors.TreeDepth, Assert.Throws<DomainException>(() => shape.EnsureCanAdd(ids[4], height: 2)).Code);
        Assert.Equal(DocErrors.TreeCycle, Assert.Throws<DomainException>(() => shape.EnsureCanMove(ids[0], ids[3])).Code);
        Assert.Equal(DocErrors.TreeDepth, Assert.Throws<DomainException>(() => shape.EnsureCanMove(ids[5], ids[4])).Code);
        shape.EnsureCanMove(ids[5], ids[3]);
        var full = new DocTreeShape([new DocTreeNode(ids[0], null, DocKind.Folder), .. Enumerable.Range(0, DocTreeShape.MaxChildrenPerFolder)
            .Select(_ => new DocTreeNode(Guid.CreateVersion7(), ids[0], DocKind.Page))]);
        Assert.Equal(DocErrors.FolderFull, Assert.Throws<DomainException>(() => full.EnsureCanAdd(ids[0])).Code);
        full.EnsureCanAdd(null);
    }

    [Fact]
    public void Documents_publish_new_versions_and_drafts_validate_their_base()
    {
        // Arrange
        var actor = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;
        var page = DocNode.CreateDocument(Guid.CreateVersion7(), 1, DocKind.Page, null, null, "a0", " Title ", "one\r\n", actor, now);

        // Act
        page.Publish("two", actor, now.AddMinutes(1));
        var version = DocVersion.Snapshot(page, null, "  ", actor, WriteChannel.Mcp, now);
        var draft = DocDraft.Create(page, actor, 2, null, "draft", now);

        // Assert
        Assert.Equal(("Title", 2, "two"), (page.Title, page.CurrentVersion, page.Content));
        Assert.Equal((2, "two", null), (version.Number, version.Content, version.ChangeNote));
        Assert.Equal(string.Empty, draft.Title);
        Assert.Equal(DocErrors.BaseVersionInvalid, Assert.Throws<DomainException>(() => draft.Update(page, 3, null, "x", now)).Code);
        Assert.Equal(DocErrors.FormatInvalid, Assert.Throws<DomainException>(() =>
            DocNode.CreateDocument(Guid.CreateVersion7(), 2, DocKind.Diagram, null, null, "a1", "Diagram", null, actor, now)).Code);
        var folder = DocNode.CreateFolder(Guid.CreateVersion7(), 3, null, "a2", "Folder", actor, now);
        Assert.Equal(DocErrors.KindUnsupported, Assert.Throws<DomainException>(() => folder.Publish("x", actor, now)).Code);
    }
}
