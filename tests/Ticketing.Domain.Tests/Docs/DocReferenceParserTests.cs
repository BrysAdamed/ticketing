using Ticketing.Domain.Docs;

namespace Ticketing.Domain.Tests.Docs;

public sealed class DocReferenceParserTests
{
    [Fact]
    public void Finds_ticket_keys_doc_keys_custom_text_links_and_embeds_in_order_once_each()
    {
        // Arrange
        const string markdown = """
            # Payments

            Work in WEB-12 and API-7, see WEB-D-3 and [the runbook](OPS-D-14).
            Again WEB-12. ![Checkout sequence](WEB-D-7 "flow")
            - [ ] WEB-D-3 twice
            """;

        // Act
        var keys = DocReferenceParser.Parse(markdown, DocKind.Page, null);

        // Assert
        Assert.Equal(["WEB-12", "API-7"], keys.Tickets.Select(Ticket));
        Assert.Equal(["WEB-D-3", "OPS-D-14", "WEB-D-7"], keys.Docs.Select(Doc));
        Assert.Equal(["WEB-D-7"], keys.Embeds.Select(Doc));
    }

    [Fact]
    public void Ignores_keys_in_code_spans_fenced_and_indented_code_and_urls()
    {
        // Arrange
        const string markdown = """
            Inline `WEB-1` and ``WEB-2 with ` tick`` but WEB-3 counts.

            ```csharp
            var key = "WEB-4";
            ```

            > ~~~
            > WEB-5 in a quoted fence
            > ~~~

                WEB-6 indented code

            Links: https://jira.example.com/browse/WEB-7 and <https://x.example/WEB-D-8>.
            """;

        // Act
        var keys = DocReferenceParser.Parse(markdown, DocKind.Page, null);

        // Assert
        Assert.Equal(["WEB-3"], keys.Tickets.Select(Ticket));
        Assert.Empty(keys.Docs);
    }

    [Fact]
    public void Indented_lines_inside_lists_are_text_not_code()
    {
        // Arrange
        const string markdown = "- first item\n\n    continues with WEB-9\n";

        // Act
        var keys = DocReferenceParser.Parse(markdown, DocKind.Page, null);

        // Assert
        Assert.Equal(["WEB-9"], keys.Tickets.Select(Ticket));
    }

    [Theory]
    [InlineData("web-12 lower case")]
    [InlineData("WEB-TC-7 test case and WEB-R-3 session")]
    [InlineData("XWEB-12x glued and a-WEB-12")]
    [InlineData("WEB-1234567890 too long")]
    [InlineData("WEB-0 zero")]
    public void Ignores_text_that_only_looks_like_a_key(string text) =>
        Assert.Empty(DocReferenceParser.Parse(text, DocKind.Page, null).Tickets);

    [Fact]
    public void Doc_keys_are_not_read_as_ticket_keys()
    {
        // Act
        var keys = DocReferenceParser.Parse("WEB-D-12", DocKind.Page, null);

        // Assert
        Assert.Empty(keys.Tickets);
        Assert.Equal(["WEB-D-12"], keys.Docs.Select(Doc));
    }

    [Fact]
    public void Mermaid_sources_are_scanned_as_text_and_canvas_and_folders_have_no_keys()
    {
        // Arrange
        const string mermaid = "flowchart LR\n  A[WEB-12 `api`] --> B[WEB-D-4]";

        // Act
        var diagram = DocReferenceParser.Parse(mermaid, DocKind.Diagram, DiagramFormat.Mermaid);
        var canvas = DocReferenceParser.Parse("{\"text\":\"WEB-12\"}", DocKind.Diagram, DiagramFormat.Canvas);

        // Assert
        Assert.Equal(["WEB-12"], diagram.Tickets.Select(Ticket));
        Assert.Equal(["WEB-D-4"], diagram.Docs.Select(Doc));
        Assert.Empty(diagram.Embeds);
        Assert.Same(DocContentKeys.None, canvas);
        Assert.Same(DocContentKeys.None, DocReferenceParser.Parse(null, DocKind.Page, null));
    }

    [Fact]
    public void Takes_at_most_500_distinct_keys_per_kind()
    {
        // Arrange
        var markdown = string.Join(' ', Enumerable.Range(1, 600).Select(n => $"WEB-{n}"));

        // Act
        var keys = DocReferenceParser.Parse(markdown, DocKind.Page, null);

        // Assert
        Assert.Equal(DocReferenceParser.MaxKeysPerKind, keys.Tickets.Count);
    }

    private static string Ticket(DocKeyReference key) => $"{key.ProjectKey}-{key.Number}";

    private static string Doc(DocKeyReference key) => $"{key.ProjectKey}-D-{key.Number}";
}
