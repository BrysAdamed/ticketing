using Ticketing.Domain.Agents;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Tests.Agents;

public sealed class PromptTemplateTests
{
    private static readonly AgentPromptContext Context = new(
        "TKT-42", TicketType.Bug, "https://ticketing.test/tickets/TKT-42", "TKT", "https://git.example.com/team/ticketing.git",
        "https://ticketing.test", "Finish: push and set Review.", "Bug v3 / C");

    [Fact]
    public void Every_placeholder_renders_its_value()
    {
        // Arrange
        var body = string.Join("\n", AgentPromptPlaceholders.All.Select(p => $"{p.Name}={{{{{p.Name}}}}}"));

        // Act
        var rendered = Render(body, Context);

        // Assert
        Assert.Equal(
            """
            ticket.key=TKT-42
            ticket.type=Bug
            ticket.url=https://ticketing.test/tickets/TKT-42
            project.key=TKT
            project.repositoryUrl=https://git.example.com/team/ticketing.git
            instance.url=https://ticketing.test
            finish=Finish: push and set Review.
            template.id=Bug v3 / C
            """.ReplaceLineEndings("\n"),
            rendered);
    }

    [Fact]
    public void Null_values_render_empty_and_spaces_inside_braces_are_allowed()
    {
        // Arrange
        var context = Context with { RepositoryUrl = null, TicketUrl = null };

        // Act
        var rendered = Render("[{{ project.repositoryUrl }}][{{ticket.url}}][{{  ticket.key  }}]", context);

        // Assert
        Assert.Equal("[][][TKT-42]", rendered);
    }

    [Theory]
    [InlineData("https://git.example.com/x.git", "a\nclone x\nb")]
    [InlineData(null, "a\nb")]
    [InlineData("   ", "a\nb")]
    public void If_blocks_keep_their_content_only_for_non_empty_values(string? repositoryUrl, string expected)
    {
        // Act
        var rendered = Render("a\n{{#if project.repositoryUrl}}clone x\n{{/if}}b", Context with { RepositoryUrl = repositoryUrl });

        // Assert
        Assert.Equal(expected, rendered);
    }

    [Fact]
    public void Placeholders_inside_an_if_block_render()
    {
        // Act
        var rendered = Render("{{#if project.repositoryUrl}}Check {{project.repositoryUrl}} for {{ticket.key}}.{{/if}}", Context);

        // Assert
        Assert.Equal("Check https://git.example.com/team/ticketing.git for TKT-42.", rendered);
    }

    [Fact]
    public void Escaped_braces_render_literally_and_values_are_never_interpreted()
    {
        // Arrange
        var context = Context with { RepositoryUrl = "{{ticket.key}}" };

        // Act
        var rendered = Render(@"\{{ticket.key}} is {{ticket.key}}; repo {{project.repositoryUrl}}", context);

        // Assert
        Assert.Equal("{{ticket.key}} is TKT-42; repo {{ticket.key}}", rendered);
    }

    [Theory]
    [InlineData("ticket.title")]
    [InlineData("ticket.description")]
    [InlineData("ticket.comments")]
    [InlineData("comment.body")]
    [InlineData("user.email")]
    [InlineData("TICKET.KEY")]
    public void Untrusted_and_unknown_placeholders_are_rejected(string name)
    {
        // Act
        var parse = PromptTemplate.Parse($"Work on {{{{{name}}}}}.", AgentPromptPlaceholders.Names);

        // Assert
        Assert.False(parse.IsValid);
        var error = Assert.Single(parse.Errors);
        Assert.Equal(AgentErrors.UnknownPlaceholder, error.Code);
        Assert.Equal((1, 9), (error.Line, error.Column));
        Assert.Contains(name, error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("a\n{{#if ticket.key}}b", AgentErrors.UnbalancedIf, 2, 1)]
    [InlineData("a\r\nbc {{/if}}", AgentErrors.UnbalancedIf, 2, 4)]
    [InlineData("{{#if ticket.key}}x\n  {{#if ticket.url}}y{{/if}}", AgentErrors.NestedIf, 2, 3)]
    [InlineData("line\nline two {{ticket.key", AgentErrors.UnclosedPlaceholder, 2, 10)]
    [InlineData("{{}}", AgentErrors.UnknownPlaceholder, 1, 1)]
    [InlineData("{{else}}", AgentErrors.UnknownPlaceholder, 1, 1)]
    [InlineData("{{#each ticket.key}}", AgentErrors.UnknownPlaceholder, 1, 1)]
    [InlineData("{{#if ticket.title}}x{{/if}}", AgentErrors.UnknownPlaceholder, 1, 1)]
    public void Syntax_errors_carry_their_code_line_and_column(string body, string code, int line, int column)
    {
        // Act
        var parse = PromptTemplate.Parse(body, AgentPromptPlaceholders.Names);

        // Assert
        Assert.False(parse.IsValid);
        var error = parse.Errors[0];
        Assert.Equal(code, error.Code);
        Assert.Equal((line, column), (error.Line, error.Column));
    }

    [Fact]
    public void Every_error_is_reported_in_position_order()
    {
        // Act
        var parse = PromptTemplate.Parse("{{/if}} {{nope}}\n{{#if ticket.key}}", AgentPromptPlaceholders.Names);

        // Assert
        Assert.Equal(
            [(AgentErrors.UnbalancedIf, 1, 1), (AgentErrors.UnknownPlaceholder, 1, 9), (AgentErrors.UnbalancedIf, 2, 1)],
            parse.Errors.Select(e => (e.Code, e.Line, e.Column)));
    }

    [Fact]
    public void EnsureValid_reports_the_first_error_with_its_position_on_the_field()
    {
        // Arrange
        var parse = PromptTemplate.Parse("ok\nnot {{ticket.title}}", AgentPromptPlaceholders.Names);

        // Act
        var error = Assert.Throws<DomainException>(() => parse.EnsureValid("body"));

        // Assert
        Assert.Equal(AgentErrors.UnknownPlaceholder, error.Code);
        Assert.Equal("body", error.Field);
        Assert.StartsWith("Line 2, column 5:", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(AgentPrompt.LengthLimit - 1, true)]
    [InlineData(AgentPrompt.LengthLimit, false)]
    public void Prompts_must_stay_below_the_deep_link_limit(int length, bool fits)
    {
        // Act
        var prompt = new string('x', length);

        // Assert
        Assert.Equal(fits, AgentPrompt.FitsLimit(prompt));
        if (!fits)
            Assert.Equal(AgentErrors.PromptTooLong, Assert.Throws<DomainException>(() => AgentPrompt.EnsureFitsLimit(prompt, "body")).Code);
    }

    [Theory]
    [InlineData("type\n", "rules", "type\n\nrules")]
    [InlineData("type", null, "type")]
    [InlineData("type", "  \n ", "type")]
    public void Guardrails_are_appended_after_a_blank_line_only_when_non_empty(string type, string? guardrails, string expected) =>
        Assert.Equal(expected, AgentPrompt.Compose(type, guardrails));

    [Fact]
    public void Template_id_names_the_type_version_and_source() =>
        Assert.Equal(
            ["Bug v3 / C", "Epic v1 / D"],
            [AgentPromptContext.TemplateIdFor(TicketType.Bug, 3, AgentPromptSource.Custom), AgentPromptContext.TemplateIdFor(TicketType.Epic, 1, AgentPromptSource.Default)]);

    private static string Render(string body, AgentPromptContext context) =>
        PromptTemplate.Parse(body, AgentPromptPlaceholders.Names).EnsureValid("body").Render(context.Values());
}
