using Ticketing.Domain.Collaboration;

namespace Ticketing.Domain.Tests.Collaboration;

public sealed class MentionsTests
{
    private static readonly Guid Maya = Guid.Parse("0199f0a1-1111-7000-8000-000000000001");
    private static readonly Guid Olek = Guid.Parse("0199f0a1-2222-7000-8000-000000000002");

    private static string M(Guid id, string name = "Maya Kowalczyk") => $"@[{name}](user:{id})";

    [Fact]
    public void Parse_finds_tokens_with_their_ranges()
    {
        // Arrange
        var text = $"Hi {M(Maya)}, see {M(Olek, "Olek")}.";

        // Act
        var tokens = Mentions.Parse(text);

        // Assert
        Assert.Equal([Maya, Olek], tokens.Select(t => t.UserId));
        Assert.Equal(["Maya Kowalczyk", "Olek"], tokens.Select(t => t.Name));
        Assert.Equal(M(Maya), text.Substring(tokens[0].Start, tokens[0].Length));
    }

    [Theory]
    [InlineData("({0})")]
    [InlineData("x{0}y")]
    [InlineData("**{0}**")]
    [InlineData("{0}{0}")]
    [InlineData("- {0}\n")]
    public void Parse_needs_no_word_boundary_around_a_token(string template)
    {
        // Act
        var ids = Mentions.UserIds(string.Format(System.Globalization.CultureInfo.InvariantCulture, template, M(Maya)));

        // Assert
        Assert.Equal([Maya], ids);
    }

    [Fact]
    public void Parse_accepts_upper_case_ids_and_parentheses_in_names()
    {
        // Act
        var tokens = Mentions.Parse($"@[Maya (QA)](user:{Maya.ToString().ToUpperInvariant()})");

        // Assert
        var token = Assert.Single(tokens);
        Assert.Equal((Maya, "Maya (QA)"), (token.UserId, token.Name));
    }

    [Theory]
    [InlineData("@[](user:0199f0a1-1111-7000-8000-000000000001)")]
    [InlineData("@[Maya](user:not-a-guid)")]
    [InlineData("@[Maya](user:0199f0a1-1111-7000-8000-00000000000)")]
    [InlineData("@[Ma[ya](user:0199f0a1-1111-7000-8000-000000000001)")]
    [InlineData("@[Ma\nya](user:0199f0a1-1111-7000-8000-000000000001)")]
    [InlineData("[Maya](user:0199f0a1-1111-7000-8000-000000000001)")]
    [InlineData("@[Maya] (user:0199f0a1-1111-7000-8000-000000000001)")]
    [InlineData("@[Maya](users:0199f0a1-1111-7000-8000-000000000001)")]
    public void Malformed_tokens_are_plain_text(string text)
    {
        // Act
        var tokens = Mentions.Parse(text);

        // Assert
        Assert.Empty(tokens);
    }

    [Theory]
    [InlineData("`{0}`")]
    [InlineData("``a ` {0}``")]
    [InlineData("```\n{0}\n```")]
    [InlineData("~~~ts\n{0}\n~~~")]
    [InlineData("   ```\n{0}\n```")]
    [InlineData("````\n```\n{0}\n````")]
    [InlineData("```\nnever closed\n{0}")]
    [InlineData("    {0}")]
    [InlineData("\t{0}")]
    [InlineData("Intro\n\n    {0}")]
    [InlineData("    code\n\n    {0}\n")]
    [InlineData("```\nx\n```\n    {0}")]
    [InlineData("- item\n\npara\n\n    {0}")]
    public void Mentions_in_code_are_ignored(string template)
    {
        // Act
        var ids = Mentions.UserIds(string.Format(System.Globalization.CultureInfo.InvariantCulture, template, M(Maya)));

        // Assert
        Assert.Empty(ids);
    }

    [Theory]
    [InlineData("`unclosed {0}")]
    [InlineData("``mismatched` {0}")]
    [InlineData("   {0}")]
    [InlineData("Paragraph\n    {0}")]
    [InlineData("- item\n\n    {0}")]
    [InlineData("1. item\n    nested\n\n    {0}")]
    [InlineData("* item\nlazy\n\n    {0}")]
    [InlineData("    code\n{0}")]
    [InlineData("    code\n\n{0}")]
    [InlineData("    a `b\n\n{0}` c")]
    [InlineData("    a `b\nc` {0}\n")]
    [InlineData("```\ncode\n```\n{0}")]
    [InlineData("```\n``` not a close\n```\n{0}")]
    [InlineData("`a` {0} `b`")]
    [InlineData("{0} `b`")]
    public void Mentions_outside_code_count(string template)
    {
        // Act
        var ids = Mentions.UserIds(string.Format(System.Globalization.CultureInfo.InvariantCulture, template, M(Maya)));

        // Assert
        Assert.Equal([Maya], ids);
    }

    [Fact]
    public void Only_the_start_of_a_token_decides_whether_it_is_in_code()
    {
        // Act
        var ids = Mentions.UserIds($"@[a`b](user:{Maya}) `x`");

        // Assert
        Assert.Equal([Maya], ids);
    }

    [Fact]
    public void UserIds_are_distinct_in_order_of_first_mention()
    {
        // Act
        var ids = Mentions.UserIds($"{M(Olek, "Olek")} {M(Maya)} {M(Olek, "Olek again")}");

        // Assert
        Assert.Equal([Olek, Maya], ids);
    }

    [Fact]
    public void NewlyMentioned_is_the_set_difference()
    {
        // Act
        var added = Mentions.NewlyMentioned($"{M(Maya)} {M(Maya)}", $"{M(Maya, "Renamed")} and {M(Olek, "Olek")} {M(Olek, "Olek")}");
        var fromNothing = Mentions.NewlyMentioned(null, M(Maya));
        var removed = Mentions.NewlyMentioned(M(Maya), "nobody");

        // Assert
        Assert.Equal([Olek], added);
        Assert.Equal([Maya], fromNothing);
        Assert.Empty(removed);
    }

    [Theory]
    [InlineData("Maya Kowalczyk", "Maya Kowalczyk")]
    [InlineData("  [Maya] (QA)\r\n ", "Maya QA")]
    [InlineData("[]()", "user")]
    [InlineData(null, "user")]
    public void Format_strips_brackets_parentheses_and_newlines(string? name, string stored)
    {
        // Act
        var token = Mentions.Format(Maya, name);

        // Assert
        Assert.Equal($"@[{stored}](user:{Maya})", token);
        Assert.Equal([Maya], Mentions.UserIds(token));
    }

    [Theory]
    [InlineData("ping @maya.k@example.com please", "maya.k@example.com")]
    [InlineData("(@maya.k@example.com)", "maya.k@example.com")]
    [InlineData("@Maya.K@Example.com.", "Maya.K@Example.com")]
    [InlineData("@maya+qa@sub.example.co.uk, thanks", "maya+qa@sub.example.co.uk")]
    public void ParseEmails_finds_at_email_mentions(string text, string email)
    {
        // Act
        var emails = Mentions.ParseEmails(text);

        // Assert
        var found = Assert.Single(emails);
        Assert.Equal(email, found.Email);
        Assert.Equal("@" + email, text.Substring(found.Start, found.Length));
    }

    [Theory]
    [InlineData("write to maya@example.com")]
    [InlineData("x@maya@example.com")]
    [InlineData("@maya")]
    [InlineData("@maya@localhost")]
    [InlineData("`@maya@example.com`")]
    [InlineData("```\n@maya@example.com\n```")]
    [InlineData("    @maya@example.com")]
    [InlineData("@[Ann @maya@example.com](user:0199f0a1-1111-7000-8000-000000000001)")]
    public void ParseEmails_skips_plain_addresses_code_and_tokens(string text)
    {
        // Act
        var emails = Mentions.ParseEmails(text);

        // Assert
        Assert.Empty(emails);
    }
}
