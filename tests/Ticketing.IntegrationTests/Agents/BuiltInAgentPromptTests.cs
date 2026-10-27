using Microsoft.Extensions.Options;
using Ticketing.Application.Agents;
using Ticketing.Domain.Agents;

namespace Ticketing.IntegrationTests.Agents;

/// <summary>The embedded built-ins are valid templates and fit the deep-link limit even with long project values.</summary>
public sealed class BuiltInAgentPromptTests
{
    private static readonly IBuiltInAgentPrompts BuiltIns = new EmbeddedAgentPrompts();

    public static TheoryData<string> Slots => [.. AgentPromptSlot.Instance.Select(s => s.Name)];

    [Theory]
    [MemberData(nameof(Slots))]
    public void Every_slot_ships_a_valid_template_of_the_current_release(string name)
    {
        // Arrange
        Assert.True(AgentPromptSlot.TryParse(name, out var slot));

        // Act
        var builtIn = BuiltIns.For(slot);

        // Assert
        Assert.Equal((slot, EmbeddedAgentPrompts.Release), (builtIn.Slot, builtIn.Version));
        Assert.True(PromptTemplate.Parse(builtIn.Body, AgentPromptPlaceholders.Names).IsValid);
        Assert.InRange(builtIn.Body.Length, 1, AgentPromptTemplate.BodyMaxLength);
    }

    [Theory]
    [InlineData(AgentMergePolicy.Review)]
    [InlineData(AgentMergePolicy.MergeWhenVerified)]
    public void Every_type_with_the_guardrails_stays_below_the_limit_for_long_values(AgentMergePolicy policy)
    {
        // Arrange
        var composer = new AgentPromptComposer(BuiltIns, Options.Create(new AgentOptions { PublicUrl = "https://ticketing.internal.example.com:8443/" }));
        var project = new AgentPromptProject("ABCDEFGHIJ", "https://gitlab.internal.example.com/" + new string('g', 200) + ".git", new string('b', GitBranchName.MaxLength), policy);
        var guardrails = BuiltIns.For(AgentPromptSlot.Guardrails).Body;

        // Act
        var prompts = AgentPromptSlot.TicketTypes.Select(slot => composer.Compose(
            BuiltIns.For(slot).Body, guardrails, composer.Context(project, 999_999_999, slot.Type!.Value, 999, AgentPromptSource.Custom))).ToList();

        // Assert
        Assert.All(prompts, p => Assert.True(AgentPrompt.FitsLimit(p), $"{p.Length} characters"));
        Assert.All(prompts, p => Assert.DoesNotContain("{{", p, StringComparison.Ordinal));
    }

    [Fact]
    public void The_finish_sentence_differs_per_merge_policy()
    {
        // Act
        var review = BuiltIns.FinishSentence(AgentMergePolicy.Review);
        var merge = BuiltIns.FinishSentence(AgentMergePolicy.MergeWhenVerified);

        // Assert
        Assert.Contains("Do not merge to main", review, StringComparison.Ordinal);
        Assert.Contains("merge it into main", merge, StringComparison.Ordinal);
    }
}
