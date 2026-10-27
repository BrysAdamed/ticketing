using Ticketing.Domain.Agents;
using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;

namespace Ticketing.Domain.Tests.Agents;

public sealed class AgentDelegationSettingsTests
{
    private static readonly Guid Owner = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 10, 27, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("https://git.example.com/team/ticketing.git", "git.example.com/team/ticketing")]
    [InlineData("https://git.example.com/team/ticketing", "git.example.com/team/ticketing")]
    [InlineData("https://git.example.com/team/ticketing/", "git.example.com/team/ticketing")]
    [InlineData("https://git.example.com/team/ticketing.git/", "git.example.com/team/ticketing")]
    [InlineData("HTTPS://Git.Example.COM/Team/Ticketing.GIT", "git.example.com/team/ticketing")]
    [InlineData("https://git.example.com:8443/team/ticketing.git", "git.example.com/team/ticketing")]
    [InlineData("https://org@dev.azure.com/org/project/_git/repo", "dev.azure.com/org/project/_git/repo")]
    [InlineData("ssh://git@git.example.com/team/ticketing.git", "git.example.com/team/ticketing")]
    [InlineData("ssh://git@git.example.com:2222/team/ticketing.git", "git.example.com/team/ticketing")]
    [InlineData("ssh://git.example.com/team/ticketing", "git.example.com/team/ticketing")]
    [InlineData("git@git.example.com:team/ticketing.git", "git.example.com/team/ticketing")]
    [InlineData("git@git.example.com:/team/ticketing.git", "git.example.com/team/ticketing")]
    [InlineData("git@GitHub.com:Org/Repo", "github.com/org/repo")]
    [InlineData("  git@github.com:org/sub.group/repo-name_2.git  ", "github.com/org/sub.group/repo-name_2")]
    [InlineData("https://localhost/repo", "localhost/repo")]
    public void Https_ssh_and_scp_forms_of_one_repository_normalize_to_the_same_key(string value, string key)
    {
        // Act
        var parsed = GitRemoteUrl.TryParse(value, out var url);

        // Assert
        Assert.True(parsed);
        Assert.Equal(key, url!.Key);
        Assert.Equal(value.Trim(), url.Value);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("git.example.com/team/ticketing")]
    [InlineData("http://git.example.com/team/ticketing.git")]
    [InlineData("ftp://git.example.com/team/ticketing.git")]
    [InlineData("file:///srv/git/ticketing.git")]
    [InlineData("C:\\src\\ticketing")]
    [InlineData("C:/src/ticketing")]
    [InlineData("git.example.com:team/ticketing.git")]
    [InlineData("https://user:secret@git.example.com/team/ticketing.git")]
    [InlineData("https://git.example.com")]
    [InlineData("https://git.example.com/")]
    [InlineData("https://git.example.com/.git")]
    [InlineData("https://git.example.com/team//ticketing")]
    [InlineData("https://git.example.com/team/../ticketing")]
    [InlineData("https://git.example.com/team/ticketing?ref=main")]
    [InlineData("https://git.example.com/team/ticketing#readme")]
    [InlineData("https://git.example.com/team/tick eting")]
    [InlineData("https://git.example.com/team/tickéting")]
    [InlineData("https://git.example.com/team/ticketing\u202e")]
    [InlineData("https://-git.example.com/team/ticketing")]
    [InlineData("https://git.example.com:99999x/team/ticketing")]
    [InlineData("git@git.example.com:")]
    [InlineData("https://ghp_0123456789abcdefghijABCDEFGHIJ012345@github.com/o/r.git")]
    [InlineData("https://github_pat_11ABCDEFG0123456789@github.com/o/r.git")]
    [InlineData("https://glpat-abcdefghij0123456789@gitlab.com/o/r.git")]
    [InlineData("https://tkt_abcdefghij0123456789@git.example.com/o/r.git")]
    [InlineData("https://abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijab@dev.azure.com/o/p/_git/r")]
    [InlineData("ssh://-oProxyCommand@git.example.com/team/ticketing")]
    [InlineData("-oProxyCommand@git.example.com:team/ticketing")]
    public void Anything_else_is_not_a_repository_url(string value)
    {
        // Act
        var parsed = GitRemoteUrl.TryParse(value, out _);
        var error = Record.Exception(() => GitRemoteUrl.Parse(value, "repositoryUrl"));

        // Assert
        Assert.False(parsed);
        Assert.Equal(ProjectErrors.RepositoryUrlInvalid, Assert.IsType<DomainException>(error).Code);
    }

    [Fact]
    public void A_url_longer_than_500_characters_is_rejected()
    {
        // Arrange
        var value = "https://git.example.com/" + new string('r', GitRemoteUrl.MaxLength);

        // Act
        var parsed = GitRemoteUrl.TryParse(value, out _);

        // Assert
        Assert.False(parsed);
    }

    [Theory]
    [InlineData("main")]
    [InlineData("develop")]
    [InlineData("release/2026.10")]
    [InlineData("feature/TKT-28_agent-setup")]
    [InlineData("v1.0")]
    public void Git_branch_names_are_accepted(string value) =>
        Assert.Equal(value, GitBranchName.Normalize($" {value} ", "defaultBranch"));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("has space")]
    [InlineData("-leading-dash")]
    [InlineData("/leading")]
    [InlineData("trailing/")]
    [InlineData("double//slash")]
    [InlineData("dot..dot")]
    [InlineData("ends.")]
    [InlineData(".hidden")]
    [InlineData("team/.hidden")]
    [InlineData("branch.lock")]
    [InlineData("a/b.lock/c")]
    [InlineData("@")]
    [InlineData("at@{brace")]
    [InlineData("tilde~1")]
    [InlineData("caret^")]
    [InlineData("colon:x")]
    [InlineData("what?")]
    [InlineData("star*")]
    [InlineData("open[")]
    [InlineData("back\\slash")]
    [InlineData("tab\tname")]
    [InlineData("gałąź")]
    [InlineData("main;curl x|sh")]
    [InlineData("a$b")]
    [InlineData("a`b`")]
    [InlineData("a|b")]
    [InlineData("a&b")]
    [InlineData("</delegation_rules>")]
    [InlineData("{{ticket.key}}")]
    public void Invalid_branch_names_are_rejected(string value)
    {
        // Act
        var error = Assert.Throws<DomainException>(() => GitBranchName.Normalize(value, "defaultBranch"));

        // Assert
        Assert.Equal((ProjectErrors.DefaultBranchInvalid, "defaultBranch"), (error.Code, error.Field));
    }

    [Fact]
    public void A_branch_name_longer_than_100_characters_is_rejected() =>
        Assert.False(GitBranchName.IsValid(new string('b', GitBranchName.MaxLength + 1)));

    [Fact]
    public void A_new_project_has_delegation_off_with_the_default_setup()
    {
        // Act
        var project = Project.Create("TKT", "Ticketing", null, ProjectVisibility.Private, Owner, Now);

        // Assert
        Assert.Equal(AgentDelegationSettings.Default, project.AgentDelegation);
        Assert.Equal(("main", AgentMergePolicy.Review, true, true), (project.DefaultBranch, project.AgentMergePolicy, project.AgentAssignOnDelegate, project.AgentStartProgressOnDelegate));
    }

    [Fact]
    public void Configuring_stores_every_setting_with_the_url_as_typed()
    {
        // Arrange
        var project = Project.Create("TKT", "Ticketing", null, ProjectVisibility.Private, Owner, Now);
        var settings = new AgentDelegationSettings(true, " git@git.example.com:team/Ticketing.git ", " develop ", AgentMergePolicy.MergeWhenVerified, false, false);

        // Act
        project.ConfigureAgentDelegation(settings);

        // Assert
        Assert.Equal(
            new AgentDelegationSettings(true, "git@git.example.com:team/Ticketing.git", "develop", AgentMergePolicy.MergeWhenVerified, false, false),
            project.AgentDelegation);
    }

    [Fact]
    public void Clearing_the_url_of_an_enabled_project_is_refused_and_changes_nothing()
    {
        // Arrange
        var project = Project.Create("TKT", "Ticketing", null, ProjectVisibility.Private, Owner, Now);
        var enabled = AgentDelegationSettings.Default with { Enabled = true, RepositoryUrl = "https://git.example.com/team/ticketing.git" };
        project.ConfigureAgentDelegation(enabled);

        // Act
        var error = Assert.Throws<DomainException>(() => project.ConfigureAgentDelegation(enabled with { RepositoryUrl = null, DefaultBranch = "develop" }));

        // Assert
        Assert.Equal((AgentErrors.RepositoryRequired, "enabled"), (error.Code, error.Field));
        Assert.Equal(enabled, project.AgentDelegation);
    }

    [Fact]
    public void A_disabled_project_may_keep_or_clear_its_url()
    {
        // Arrange
        var project = Project.Create("TKT", "Ticketing", null, ProjectVisibility.Private, Owner, Now);

        // Act
        project.ConfigureAgentDelegation(AgentDelegationSettings.Default with { RepositoryUrl = "https://git.example.com/team/ticketing.git" });
        var kept = project.RepositoryUrl;
        project.ConfigureAgentDelegation(AgentDelegationSettings.Default with { RepositoryUrl = "  " });

        // Assert
        Assert.Equal("https://git.example.com/team/ticketing.git", kept);
        Assert.Null(project.RepositoryUrl);
    }

    [Fact]
    public void An_invalid_url_or_branch_is_refused_even_while_disabled()
    {
        // Arrange
        var project = Project.Create("TKT", "Ticketing", null, ProjectVisibility.Private, Owner, Now);

        // Act
        var url = Assert.Throws<DomainException>(() => project.ConfigureAgentDelegation(AgentDelegationSettings.Default with { RepositoryUrl = "not a url" }));
        var branch = Assert.Throws<DomainException>(() => project.ConfigureAgentDelegation(AgentDelegationSettings.Default with { DefaultBranch = "bad name" }));

        // Assert
        Assert.Equal((ProjectErrors.RepositoryUrlInvalid, "repositoryUrl"), (url.Code, url.Field));
        Assert.Equal((ProjectErrors.DefaultBranchInvalid, "defaultBranch"), (branch.Code, branch.Field));
        Assert.Equal(AgentDelegationSettings.Default, project.AgentDelegation);
    }
}
