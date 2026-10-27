using Ticketing.Domain.Docs;

namespace Ticketing.Domain.Tests.Docs;

public sealed class CanvasOutlineTests
{
    private static string Scene(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "TestData", "Canvas", $"{name}.excalidraw"));

    [Fact]
    public void Architecture_scene_saved_by_the_editor_gives_labels_and_bound_arrows()
    {
        // Act
        var outline = CanvasOutline.Extract(Scene("architecture"));

        // Assert
        Assert.Equal(["API", "DB", "Gotenberg", "Free note: renderer has no egress"], outline.Labels);
        Assert.Equal(["API → DB (SQL)", "API → Gotenberg"], outline.Relations.Select(r => r.ToString()));
    }

    [Fact]
    public void Whiteboard_scene_keeps_texts_and_frame_names_but_skips_deleted_and_unbound()
    {
        // Act
        var outline = CanvasOutline.Extract(Scene("whiteboard"));

        // Assert
        Assert.Equal(["Sprint 42 retro", "Keep WIP low", "What went well?", "Ship the Docs epic"], outline.Labels);
        Assert.Empty(outline.Relations);
    }

    [Fact]
    public void Connector_scene_follows_arrowheads_and_names_unlabelled_shapes_by_type()
    {
        // Act
        var outline = CanvasOutline.Extract(Scene("connectors"));

        // Assert
        Assert.Equal(["Client", "Server", "Queue", "Cache"], outline.Labels);
        Assert.Equal(
            ["Client → Server (HTTPS)", "Queue → Server", "Server ↔ Cache", "Client — [ellipse]", "Queue → [ellipse]"],
            outline.Relations.Select(r => r.ToString()));
    }

    [Fact]
    public void ToText_lists_labels_then_relations_one_per_line()
    {
        // Act
        var text = CanvasOutline.Extract(Scene("architecture")).ToText();

        // Assert
        Assert.Equal(
            string.Join('\n', "API", "DB", "Gotenberg", "Free note: renderer has no egress", "API → DB (SQL)", "API → Gotenberg"),
            text);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Blank_source_is_an_empty_outline(string source) =>
        Assert.Same(CanvasOutline.Empty, CanvasOutline.Extract(source));

    [Theory]
    [InlineData("{not json")]
    [InlineData("[]")]
    [InlineData("{\"type\":\"excalidraw\"}")]
    [InlineData("{\"elements\":{}}")]
    public void Source_that_is_not_a_scene_is_rejected(string source) =>
        Assert.Throws<FormatException>(() => CanvasOutline.Extract(source));
}
