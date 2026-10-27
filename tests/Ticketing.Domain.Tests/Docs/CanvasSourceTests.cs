using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Domain.Tests.Docs;

public sealed class CanvasSourceTests
{
    private static string Scene(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "TestData", "Canvas", $"{name}.excalidraw"));

    private static string Elements(string elements, string extra = "") => $$"""{"type":"excalidraw","version":2,"elements":[{{elements}}]{{extra}}}""";

    [Theory]
    [InlineData("architecture")]
    [InlineData("whiteboard")]
    [InlineData("connectors")]
    public void Scenes_saved_by_the_editor_are_valid_and_give_their_outline(string name)
    {
        // Act
        var outline = CanvasSource.Validate(Scene(name));

        // Assert
        Assert.Equal(CanvasOutline.Extract(Scene(name)), outline, OutlineComparer.Instance);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void Blank_source_is_an_empty_canvas(string? source) =>
        Assert.Same(CanvasOutline.Empty, CanvasSource.Validate(source));

    [Theory]
    [InlineData("{not json")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("""{"elements":[]}""")]
    [InlineData("""{"type":"tldraw","elements":[]}""")]
    [InlineData("""{"type":"excalidraw","elements":{}}""")]
    [InlineData("""{"type":"excalidraw","elements":[1]}""")]
    [InlineData("""{"type":"excalidraw","elements":[{"id":"e","type":"embeddable"}]}""")]
    [InlineData("""{"type":"excalidraw","elements":[{"id":"f","type":"iframe"}]}""")]
    public void Source_that_is_not_an_allowed_scene_is_invalid(string source) =>
        AssertRejected(source, DocErrors.DiagramInvalidSource);

    [Theory]
    [InlineData("""{"id":"i","type":"image","fileId":"abc"}""", "")]
    [InlineData("", ""","files":{"abc":{"mimeType":"image/png","dataURL":"data:image/png;base64,AAAA"}}""")]
    [InlineData("", ""","files":[]""")]
    public void Images_and_embedded_files_are_rejected(string elements, string extra) =>
        AssertRejected(Elements(elements, extra), DocErrors.DiagramEmbeddedFiles);

    [Fact]
    public void Empty_files_are_allowed() =>
        Assert.Empty(CanvasSource.Validate(Elements("", ""","files":{}""")).Labels);

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,hi")]
    [InlineData("//evil.example.com/x")]
    [InlineData("ftp://files.example.com")]
    [InlineData("/\\evil.example.com")]
    public void Links_other_than_http_and_app_relative_are_rejected(string link) =>
        AssertRejected(Elements($$"""{"id":"r","type":"rectangle","link":{{System.Text.Json.JsonSerializer.Serialize(link)}}}"""), DocErrors.DiagramInvalidSource);

    [Theory]
    [InlineData("https://example.com/runbook")]
    [InlineData("http://intranet/wiki")]
    [InlineData("/projects/WEB/docs/WEB-D-3")]
    [InlineData("")]
    public void Http_and_app_relative_links_are_allowed(string link) =>
        Assert.Empty(CanvasSource.Validate(Elements($$"""{"id":"r","type":"rectangle","link":"{{link}}"}""")).Relations);

    [Fact]
    public void More_than_the_element_limit_is_rejected()
    {
        // Arrange
        var element = """{"id":"x","type":"rectangle"}""";
        var atLimit = Elements(string.Join(',', Enumerable.Repeat(element, CanvasSource.MaxElements)));
        var overLimit = Elements(string.Join(',', Enumerable.Repeat(element, CanvasSource.MaxElements + 1)));

        // Act
        var valid = CanvasSource.Validate(atLimit);

        // Assert
        Assert.Empty(valid.Labels);
        AssertRejected(overLimit, DocErrors.DiagramTooManyElements);
    }

    private static void AssertRejected(string source, string code)
    {
        var error = Assert.Throws<DomainException>(() => CanvasSource.Validate(source));
        Assert.Equal((code, "content"), (error.Code, error.Field));
    }

    private sealed class OutlineComparer : IEqualityComparer<CanvasOutline>
    {
        public static readonly OutlineComparer Instance = new();

        public bool Equals(CanvasOutline? x, CanvasOutline? y) => x?.ToText() == y?.ToText();

        public int GetHashCode(CanvasOutline obj) => obj.ToText().GetHashCode(StringComparison.Ordinal);
    }
}
