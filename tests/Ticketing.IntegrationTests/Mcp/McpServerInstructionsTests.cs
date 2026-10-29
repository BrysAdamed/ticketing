using System.Text.RegularExpressions;
using Ticketing.Api.Mcp;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Mcp;

[Collection(nameof(McpCollection))]
public sealed partial class McpServerInstructionsTests(TicketingApiFactory api)
{
    [Fact]
    public async Task Initialize_returns_the_primer_as_server_instructions()
    {
        // Arrange
        var user = await api.CreateUserAsync();

        // Act
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));

        // Assert
        var instructions = mcp.ServerInstructions;
        Assert.Equal(Normalize(McpServerInstructions.Text), Normalize(instructions));
        Assert.Contains("`whoami`", instructions);
        Assert.Contains("Transitions are free", instructions);
        Assert.Contains("exactly one place", instructions);
        Assert.Contains("not found", instructions);
        Assert.Contains("`idempotencyKey`", instructions);
        Assert.Contains("WEB-42", instructions);
    }

    [Fact]
    public void Docs_mirror_the_server_instructions_verbatim()
    {
        // Arrange
        var docs = File.ReadAllText(Path.Combine(RepositoryRoot(), "docs", "mcp.md"));

        // Act
        var match = MirrorBlock().Match(Normalize(docs));

        // Assert
        Assert.True(match.Success, "docs/mcp.md has no ```text block between the mcp-server-instructions markers");
        Assert.Equal(Normalize(McpServerInstructions.Text), match.Groups["text"].Value);
    }

    private static string Normalize(string? text) => (text ?? string.Empty).ReplaceLineEndings("\n").Trim();

    private static string RepositoryRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "Ticketing.slnx")))
                return dir.FullName;
        }

        throw new InvalidOperationException("Ticketing.slnx not found above " + AppContext.BaseDirectory);
    }

    [GeneratedRegex("<!-- mcp-server-instructions:start -->\\s*```text\\n(?<text>.*?)\\n```\\s*<!-- mcp-server-instructions:end -->", RegexOptions.Singleline)]
    private static partial Regex MirrorBlock();
}
