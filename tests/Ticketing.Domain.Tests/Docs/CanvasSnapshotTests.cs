using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Domain.Tests.Docs;

public sealed class CanvasSnapshotTests
{
    private const string Exported = """
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">
          <!-- svg-source:excalidraw -->
          <defs><style class="style-fonts">@font-face { font-family: Excalifont; src: url(data:font/woff2;base64,AAAA); }</style></defs>
          <rect x="0" y="0" width="200" height="100" fill="#ffffff"></rect>
          <a href="https://example.com/runbook"><g><path d="M0 0 L10 10" stroke="#1e1e1e"></path></g></a>
          <a href="/projects/WEB/docs/WEB-D-3"><text x="10" y="20" font-family="Excalifont">API</text></a>
          <use href="#shape"></use>
        </svg>
        """;

    [Fact]
    public void An_svg_exported_by_the_editor_is_kept_trimmed()
    {
        // Act
        var svg = CanvasSnapshot.Normalize($"\n  {Exported}  \n");

        // Assert
        Assert.Equal(Exported.Trim(), svg);
    }

    [Theory]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)"/></svg>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>x</text></a></svg>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"/></svg>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg"><iframe src="https://example.com"/></svg>""")]
    [InlineData("""<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>""")]
    [InlineData("""<html><body>not svg</body></html>""")]
    [InlineData("""<svg><rect/></svg>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>""")]
    [InlineData("not xml")]
    [InlineData("   ")]
    public void Active_content_and_anything_but_svg_are_rejected(string svg)
    {
        // Act
        var error = Assert.Throws<DomainException>(() => CanvasSnapshot.Normalize(svg));

        // Assert
        Assert.Equal((DocErrors.SnapshotInvalid, "snapshot"), (error.Code, error.Field));
    }

    [Fact]
    public void A_snapshot_over_the_size_limit_is_rejected()
    {
        // Arrange
        var svg = $"""<svg xmlns="http://www.w3.org/2000/svg"><desc>{new string('x', CanvasSnapshot.MaxLength)}</desc></svg>""";

        // Act
        var error = Assert.Throws<DomainException>(() => CanvasSnapshot.Normalize(svg));

        // Assert
        Assert.Equal(DocErrors.SnapshotInvalid, error.Code);
    }
}
