using Ticketing.Application.Docs;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Turning <c>ts_headline</c> output into plain text with highlight ranges.</summary>
public sealed class DocSnippetTests
{
    private const char S = DocSnippets.StartMark;
    private const char E = DocSnippets.StopMark;

    [Fact]
    public void Markers_become_ranges_over_collapsed_whitespace_without_markdown_marks()
    {
        // Act
        var snippet = DocSnippets.Build($"## Payment\n\nthe   **{S}idempotency{E}** key and {S}idempotent{E}{S}ly{E} done")!;

        // Assert
        Assert.Equal("Payment the idempotency key and idempotently done", snippet.Text);
        Assert.Equal([new TextRangeDto(12, 11), new TextRangeDto(32, 12)], snippet.Highlights);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" \n ** ")]
    public void Empty_sources_have_no_snippet(string? source) =>
        Assert.Null(DocSnippets.Build(source));

    [Fact]
    public void Long_text_is_cut_at_a_word_and_ranges_beyond_are_dropped()
    {
        // Arrange
        var words = string.Join(' ', Enumerable.Range(0, 80).Select(i => $"word{i}"));

        // Act
        var snippet = DocSnippets.Build($"{S}word{E} " + words + $" {S}tail{E}")!;

        // Assert
        Assert.True(snippet.Text.Length <= DocSnippets.MaxLength + 1);
        Assert.EndsWith("…", snippet.Text, StringComparison.Ordinal);
        Assert.DoesNotContain(" …", snippet.Text, StringComparison.Ordinal);
        Assert.Equal([new TextRangeDto(0, 4)], snippet.Highlights);
    }

    [Fact]
    public void An_unclosed_marker_closes_at_the_end()
    {
        // Act
        var snippet = DocSnippets.Build($"see {S}below")!;

        // Assert
        Assert.Equal([new TextRangeDto(4, 5)], snippet.Highlights);
    }
}
