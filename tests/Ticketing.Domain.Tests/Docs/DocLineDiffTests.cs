using System.Diagnostics;
using System.Text;
using Ticketing.Domain.Docs;

namespace Ticketing.Domain.Tests.Docs;

public sealed class DocLineDiffTests
{
    [Theory]
    [InlineData(null, null, 0, 0)]
    [InlineData("", "# Title\nText\n", 2, 0)]
    [InlineData("# Title\nText", "", 0, 2)]
    [InlineData("a\nb\nc\n", "a\nb\nc\n", 0, 0)]
    [InlineData("a\nb\nc\n", "a\nB\nc\n", 1, 1)]
    [InlineData("a\nb\nc\n", "a\nb\nc\nd\ne\n", 2, 0)]
    [InlineData("a\nb\nc\nd\n", "b\nd\n", 0, 2)]
    [InlineData("a\r\nb\r\n", "a\nb\nc", 1, 0)]
    [InlineData("a\nb\nc\nd\ne\n", "e\nb\nc\nd\na\n", 2, 2)]
    [InlineData("x\n\nx\n\nx\n", "x\n\ny\n\nx\n\nx\n", 2, 0)]
    public void Counts_the_lines_of_a_shortest_diff(string? before, string? after, int added, int removed) =>
        Assert.Equal(new DocLineChanges(added, removed), DocLineDiff.Count(before, after));

    [Fact]
    public void A_rewritten_100_kb_page_is_counted_quickly()
    {
        // Arrange
        var before = Page(revision: 1, lines: 1_500);
        var after = Page(revision: 2, lines: 1_500);
        var watch = Stopwatch.StartNew();

        // Act
        var changes = DocLineDiff.Count(before, after);

        // Assert
        Assert.Equal(new DocLineChanges(1_500, 1_500), changes);
        Assert.True(watch.ElapsedMilliseconds < 500, $"{watch.ElapsedMilliseconds} ms");
    }

    private static string Page(int revision, int lines)
    {
        var text = new StringBuilder();
        for (var i = 0; i < lines; i++)
            text.Append("Line ").Append(i).Append(" of revision ").Append(revision).Append(": the quick brown fox jumps over the lazy dog.\n");
        return text.ToString();
    }
}
