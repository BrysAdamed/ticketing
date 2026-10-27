using Microsoft.Extensions.Options;
using Ticketing.Application.Agents;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;

namespace Ticketing.IntegrationTests.Agents;

/// <summary>The embedded built-ins are valid templates, fit the deep-link limit with worst-case values and say what each type must do.</summary>
public sealed class BuiltInAgentPromptTests
{
    private static readonly IBuiltInAgentPrompts BuiltIns = new EmbeddedAgentPrompts();

    public static TheoryData<string> Slots => [.. AgentPromptSlot.Instance.Select(s => s.Name)];

    public static TheoryData<AgentMergePolicy> Policies => [AgentMergePolicy.Review, AgentMergePolicy.MergeWhenVerified];

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
    [MemberData(nameof(Policies))]
    public void The_finish_sentences_are_valid_templates_without_a_finish_placeholder(AgentMergePolicy policy)
    {
        // Act
        var parsed = PromptTemplate.Parse(BuiltIns.FinishSentence(policy), AgentPromptPlaceholders.Names);

        // Assert
        Assert.True(parsed.IsValid);
        Assert.DoesNotContain("{{finish", BuiltIns.FinishSentence(policy), StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(Policies))]
    public void Every_type_with_the_guardrails_stays_below_the_limit_for_worst_case_values(AgentMergePolicy policy)
    {
        // Arrange
        var publicUrl = "https://" + new string('h', 100) + ".example.com:8443/" + new string('p', 30);
        var composer = new AgentPromptComposer(BuiltIns, Options.Create(new AgentOptions { PublicUrl = publicUrl }));
        var repositoryHead = "https://gitlab.internal.example.com/";
        var repositoryUrl = repositoryHead + new string('g', GitRemoteUrl.MaxLength - repositoryHead.Length - 4) + ".git";
        var project = new AgentPromptProject(new string('K', Project.KeyMaxLength), repositoryUrl, new string('b', GitBranchName.MaxLength), policy);
        var guardrails = BuiltIns.For(AgentPromptSlot.Guardrails).Body;

        // Act
        var prompts = AgentPromptSlot.TicketTypes.Select(slot => composer.Compose(
            BuiltIns.For(slot).Body, guardrails, composer.Context(project, int.MaxValue, slot.Type!.Value, 99_999, AgentPromptSource.Custom))).ToList();

        // Assert
        Assert.Equal(GitRemoteUrl.MaxLength, repositoryUrl.Length);
        Assert.All(prompts, p => Assert.True(AgentPrompt.FitsLimit(p), $"{p.Length} characters"));
        Assert.All(prompts, p => Assert.DoesNotContain("{{", p, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(AgentMergePolicy.Review, "Do not merge it yourself: a person reviews and merges.")]
    [InlineData(AgentMergePolicy.MergeWhenVerified, "Then merge your branch back as CLAUDE.md describes")]
    public void The_finish_step_names_the_ticket_key_and_the_default_branch_of_the_merge_policy(AgentMergePolicy policy, string expected)
    {
        // Arrange
        var composer = new AgentPromptComposer(BuiltIns, Options.Create(new AgentOptions { PublicUrl = "https://ticketing.test" }));
        var project = new AgentPromptProject("WEB", "git@git.example.com:team/web.git", "develop", policy);

        // Act
        var prompt = composer.Compose(BuiltIns.For(new AgentPromptSlot(TicketType.Bug)).Body, null,
            composer.Context(project, 42, TicketType.Bug, 1, AgentPromptSource.Default));

        // Assert
        Assert.Contains("7. Finish: commit with messages starting WEB-42, merge the latest develop into your branch", prompt, StringComparison.Ordinal);
        Assert.Contains(expected, prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void The_guardrails_check_the_clone_against_the_repository_url()
    {
        // Arrange
        var composer = new AgentPromptComposer(BuiltIns, Options.Create(new AgentOptions { PublicUrl = "https://ticketing.test" }));
        var project = new AgentPromptProject("WEB", "git@git.example.com:team/web.git", "main", AgentMergePolicy.Review);

        // Act
        var rules = composer.Compose(BuiltIns.For(AgentPromptSlot.Guardrails).Body, null,
            composer.Context(project, 42, TicketType.Bug, 1, AgentPromptSource.Default));

        // Assert
        Assert.Contains("First compare `git remote get-url origin` with git@git.example.com:team/web.git, ignoring case", rules, StringComparison.Ordinal);
        Assert.Contains("this is the wrong folder: say so and stop", rules, StringComparison.Ordinal);
        Assert.Contains("starting \"Delegated run · Bug v1 / D\"", rules, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(TicketType.Epic, new[] { "create_tickets", "acceptance criteria", "Blocks", "Do not change code" })]
    [InlineData(TicketType.UserStory, new[] { "worktree", "tests", "in the browser", "{{finish}}" })]
    [InlineData(TicketType.Technical, new[] { "worktree", "tests", "in the browser", "{{finish}}" })]
    [InlineData(TicketType.Spike, new[] { "not production code", "create_tickets", "RelatesTo", "{{finish}}" })]
    [InlineData(TicketType.Bug, new[] { "automated test that fails", "root cause", "{{finish}}" })]
    public void Every_type_reads_the_ticket_follows_claude_md_and_states_its_own_workflow(TicketType type, string[] workflow)
    {
        // Act
        var body = BuiltIns.For(new AgentPromptSlot(type)).Body;

        // Assert
        Assert.All(["get_ticket", "CLAUDE.md", "{{ticket.key}}", .. workflow], s => Assert.Contains(s, body, StringComparison.Ordinal));
    }
}
