using Ticketing.Domain.Agents;
using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Tests.Agents;

public sealed class AgentPromptTemplateTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 27, 12, 0, 0, TimeSpan.Zero);
    private static readonly Guid Admin = Guid.CreateVersion7();
    private static readonly AgentPromptSlot Bug = new(TicketType.Bug);
    private static readonly BuiltInPrompt BugV1 = new(Bug, "2026.10.1", "Fix {{ticket.key}}.");
    private static readonly BuiltInPrompt BugV2 = new(Bug, "2026.11.1", "Reproduce, then fix {{ticket.key}}.");

    [Fact]
    public void An_instance_row_starts_as_the_built_in_and_follows_it()
    {
        // Act
        var (template, version) = AgentPromptTemplate.CreateInstance(BugV1, Now);

        // Assert
        Assert.Equal((1, AgentPromptMode.Custom, "Fix {{ticket.key}}.", true, "2026.10.1"), (template.CurrentVersion, template.Mode, template.Body, template.FollowsBuiltIn, template.BuiltInVersion));
        Assert.Equal((1, "2026.10.1", (Guid?)null), (version.Number, version.BuiltInVersion, version.AuthorId));
        Assert.Null(template.UpdatedById);
    }

    [Fact]
    public void An_unedited_instance_row_upgrades_to_a_newer_built_in()
    {
        // Arrange
        var (template, _) = AgentPromptTemplate.CreateInstance(BugV1, Now);

        // Act
        var version = template.UpgradeToBuiltIn(BugV2, Now.AddDays(30));

        // Assert
        Assert.NotNull(version);
        Assert.Equal((2, "2026.11.1", "Built-in 2026.11.1"), (version.Number, version.BuiltInVersion, version.ChangeNote));
        Assert.Equal((BugV2.Body, "2026.11.1", true), (template.Body, template.BuiltInVersion, template.FollowsBuiltIn));
        Assert.False(template.NewerBuiltInAvailable(BugV2));
    }

    [Fact]
    public void An_edited_instance_row_is_left_alone_and_reports_the_newer_built_in()
    {
        // Arrange
        var (template, _) = AgentPromptTemplate.CreateInstance(BugV1, Now);
        template.Save(AgentPromptMode.Custom, "Our own bug prompt for {{ticket.key}}.", "house style", null, Admin, Now);

        // Act
        var version = template.UpgradeToBuiltIn(BugV2, Now.AddDays(30));

        // Assert
        Assert.Null(version);
        Assert.Equal((2, "Our own bug prompt for {{ticket.key}}.", false), (template.CurrentVersion, template.Body, template.FollowsBuiltIn));
        Assert.False(template.NewerBuiltInAvailable(BugV1));
        Assert.True(template.NewerBuiltInAvailable(BugV2));
    }

    [Fact]
    public void Adopting_the_built_in_after_an_edit_makes_the_row_follow_later_releases_again()
    {
        // Arrange
        var (template, _) = AgentPromptTemplate.CreateInstance(BugV1, Now);
        template.Save(AgentPromptMode.Custom, "Edited.", null, null, Admin, Now);

        // Act
        var adopted = template.AdoptBuiltIn(BugV2, Admin, Now, "Adopt");

        // Assert
        Assert.Equal((3, "2026.11.1", (Guid?)Admin), (adopted.Number, adopted.BuiltInVersion, adopted.AuthorId));
        Assert.True(template.FollowsBuiltIn);
        Assert.Null(template.UpgradeToBuiltIn(BugV2, Now));
    }

    [Fact]
    public void A_release_that_does_not_change_the_text_adds_no_version()
    {
        // Arrange
        var (template, _) = AgentPromptTemplate.CreateInstance(BugV1, Now);

        // Act
        var version = template.UpgradeToBuiltIn(BugV1 with { Version = "2026.11.1" }, Now);

        // Assert
        Assert.Null(version);
        Assert.Equal((1, "2026.11.1"), (template.CurrentVersion, template.BuiltInVersion));
    }

    [Theory]
    [InlineData("2026.10.10", "2026.10.9", true)]
    [InlineData("2026.11.1", "2026.10.1", true)]
    [InlineData("2026.10.1", "2026.10.1", false)]
    [InlineData("2026.9.1", "2026.10.1", false)]
    [InlineData("2026.10.1", null, true)]
    public void Built_in_releases_compare_numerically(string candidate, string? current, bool newer) =>
        Assert.Equal(newer, (BugV1 with { Version = candidate }).IsNewerThan(current));

    [Fact]
    public void A_project_slot_starts_inheriting_and_each_save_is_a_new_version()
    {
        // Arrange
        var template = AgentPromptTemplate.CreateForProject(Guid.CreateVersion7(), TicketType.Bug, Now);

        // Act
        var custom = template.Save(AgentPromptMode.Custom, "  Fix {{ticket.key}}.\r\n", "ours", defaultVersion: 4, Admin, Now);
        var off = template.Save(AgentPromptMode.Off, "ignored", null, defaultVersion: 4, Admin, Now);

        // Assert
        Assert.Equal((1, AgentPromptMode.Custom, "Fix {{ticket.key}}.", "ours"), (custom.Number, custom.Mode, custom.Body, custom.ChangeNote));
        Assert.Equal((2, AgentPromptMode.Off, (string?)null), (off.Number, off.Mode, off.Body));
        Assert.Equal((2, AgentPromptMode.Off, (string?)null, (int?)null), (template.CurrentVersion, template.Mode, template.Body, template.BasedOnDefaultVersion));
    }

    [Fact]
    public void A_custom_project_row_remembers_the_default_version_it_was_written_against()
    {
        // Arrange
        var template = AgentPromptTemplate.CreateForProject(Guid.CreateVersion7(), TicketType.Bug, Now);

        // Act
        template.Save(AgentPromptMode.Custom, "Fix it.", null, defaultVersion: 4, Admin, Now);

        // Assert
        Assert.Equal(4, template.BasedOnDefaultVersion);
    }

    [Fact]
    public void Restoring_a_version_adds_a_new_one_pointing_at_it()
    {
        // Arrange
        var template = AgentPromptTemplate.CreateForProject(Guid.CreateVersion7(), TicketType.Bug, Now);
        var first = template.Save(AgentPromptMode.Custom, "First.", null, 1, Admin, Now);
        template.Save(AgentPromptMode.Inherit, null, null, 1, Admin, Now);

        // Act
        var restored = template.Restore(first, "back", 2, Admin, Now);

        // Assert
        Assert.Equal((3, AgentPromptMode.Custom, "First.", (int?)1), (restored.Number, restored.Mode, restored.Body, restored.RestoredFrom));
        Assert.Equal(2, template.BasedOnDefaultVersion);
    }

    [Theory]
    [InlineData(AgentPromptMode.Inherit)]
    [InlineData(AgentPromptMode.Off)]
    public void Instance_rows_are_always_custom(AgentPromptMode mode)
    {
        // Arrange
        var (template, _) = AgentPromptTemplate.CreateInstance(BugV1, Now);

        // Act
        var error = Assert.Throws<DomainException>(() => template.Save(mode, null, null, null, Admin, Now));

        // Assert
        Assert.Equal(AgentErrors.ModeInvalid, error.Code);
    }

    [Fact]
    public void A_custom_type_template_needs_a_body_but_the_guardrails_may_be_empty()
    {
        // Arrange
        var project = AgentPromptTemplate.CreateForProject(Guid.CreateVersion7(), TicketType.Bug, Now);
        var (guardrails, _) = AgentPromptTemplate.CreateInstance(new BuiltInPrompt(AgentPromptSlot.Guardrails, "2026.10.1", "Rules."), Now);

        // Act
        var error = Assert.Throws<DomainException>(() => project.Save(AgentPromptMode.Custom, "  ", null, 1, Admin, Now));
        var cleared = guardrails.Save(AgentPromptMode.Custom, "", null, null, Admin, Now);

        // Assert
        Assert.Equal(AgentErrors.TemplateEmpty, error.Code);
        Assert.Null(cleared.Body);
    }

    [Fact]
    public void Template_syntax_and_length_are_validated_on_save()
    {
        // Arrange
        var template = AgentPromptTemplate.CreateForProject(Guid.CreateVersion7(), TicketType.Bug, Now);

        // Act
        var syntax = Assert.Throws<DomainException>(() => template.Save(AgentPromptMode.Custom, "Fix {{ticket.title}}", null, 1, Admin, Now));
        var length = Assert.Throws<DomainException>(() => template.Save(AgentPromptMode.Custom, new string('x', AgentPromptTemplate.BodyMaxLength + 1), null, 1, Admin, Now));

        // Assert
        Assert.Equal((AgentErrors.UnknownPlaceholder, "body"), (syntax.Code, syntax.Field));
        Assert.Equal(AgentErrors.TemplateTooLong, length.Code);
        Assert.Equal(0, template.CurrentVersion);
    }

    [Fact]
    public void A_stale_base_version_is_a_version_conflict()
    {
        // Arrange
        var template = AgentPromptTemplate.CreateForProject(Guid.CreateVersion7(), TicketType.Bug, Now);
        template.Save(AgentPromptMode.Off, null, null, 1, Admin, Now);

        // Act
        var error = Assert.Throws<DomainException>(() => template.EnsureBaseVersion(0));

        // Assert
        Assert.Equal((AgentErrors.VersionConflict, DomainErrorKind.Conflict), (error.Code, error.Kind));
        template.EnsureBaseVersion(1);
    }

    [Theory]
    [InlineData("bug", TicketType.Bug)]
    [InlineData("USERSTORY", TicketType.UserStory)]
    [InlineData(" Guardrails ", null)]
    public void Slots_parse_type_names_and_guardrails_ignoring_case(string value, TicketType? type)
    {
        // Act
        var parsed = AgentPromptSlot.TryParse(value, out var slot);

        // Assert
        Assert.True(parsed);
        Assert.Equal(type, slot.Type);
    }

    [Theory]
    [InlineData("5")]
    [InlineData("")]
    [InlineData("story")]
    [InlineData(null)]
    public void Slots_reject_numbers_and_unknown_names(string? value) =>
        Assert.False(AgentPromptSlot.TryParse(value, out _));

    [Fact]
    public void Enabling_delegation_on_a_project_needs_a_repository_url()
    {
        // Arrange
        var project = Project.Create("TKT", "Ticketing", null, ProjectVisibility.Public, Admin, Now);

        // Act
        var error = Assert.Throws<DomainException>(() => project.ConfigureAgentDelegation(true, " ", AgentMergePolicy.Review));
        project.ConfigureAgentDelegation(true, "https://git.example.com/team/ticketing.git", AgentMergePolicy.MergeWhenVerified);

        // Assert
        Assert.Equal(AgentErrors.RepositoryRequired, error.Code);
        Assert.Equal((true, AgentMergePolicy.MergeWhenVerified), (project.AgentDelegationEnabled, project.AgentMergePolicy));
    }
}
