using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;

namespace Ticketing.Domain.Tests.Projects;

public sealed class ProjectAndUserTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 26, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(true, GlobalRole.Admin, ProjectVisibility.Private, null, ProjectRole.Owner)]
    [InlineData(true, GlobalRole.User, ProjectVisibility.Private, ProjectRole.Viewer, ProjectRole.Viewer)]
    [InlineData(true, GlobalRole.User, ProjectVisibility.Private, null, null)]
    [InlineData(true, GlobalRole.User, ProjectVisibility.Public, null, ProjectRole.Member)]
    [InlineData(true, GlobalRole.User, ProjectVisibility.Public, ProjectRole.Viewer, ProjectRole.Member)]
    [InlineData(true, GlobalRole.User, ProjectVisibility.Public, ProjectRole.Owner, ProjectRole.Owner)]
    [InlineData(false, GlobalRole.Admin, ProjectVisibility.Public, ProjectRole.Owner, null)]
    public void Effective_access_follows_spec_5_1(bool active, GlobalRole role, ProjectVisibility visibility, ProjectRole? membership, ProjectRole? expected) =>
        Assert.Equal(expected, ProjectAccessPolicy.Effective(active, role, visibility, membership));

    [Theory]
    [InlineData("WEB")]
    [InlineData("CORE2")]
    [InlineData("ABCDEFGHIJ")]
    public void Valid_project_keys(string key) => Assert.Equal(key, Project.NormalizeKey(key));

    [Theory]
    [InlineData("W")]
    [InlineData("web")]
    [InlineData("2WEB")]
    [InlineData("WEB-1")]
    [InlineData("ABCDEFGHIJK")]
    public void Invalid_project_keys(string key) =>
        Assert.Equal(ProjectErrors.KeyInvalid, Assert.Throws<DomainException>(() => Project.NormalizeKey(key)).Code);

    [Fact]
    public void Creator_becomes_owner_and_the_last_owner_cannot_leave()
    {
        // Arrange
        var creator = Guid.CreateVersion7();
        var project = Project.Create("WEB", "Website", null, ProjectVisibility.Private, creator, Now);

        // Act
        var error = Assert.Throws<DomainException>(() => project.RemoveMember(creator));
        project.AddMember(Guid.CreateVersion7(), ProjectRole.Owner, creator, Now);
        project.ChangeMemberRole(creator, ProjectRole.Member);

        // Assert
        Assert.Equal(ProjectErrors.LastOwner, error.Code);
        Assert.Equal(ProjectRole.Member, project.Members.Single(m => m.UserId == creator).Role);
    }

    [Fact]
    public void Only_archived_projects_can_be_deleted()
    {
        // Arrange
        var actor = Guid.CreateVersion7();
        var project = Project.Create("WEB", "Website", null, ProjectVisibility.Private, actor, Now);

        // Act / Assert
        Assert.Equal(ProjectErrors.NotArchived, Assert.Throws<DomainException>(() => project.Delete(actor, Now)).Code);
        project.Archive(actor, Now);
        Assert.Equal(ProjectErrors.Archived, Assert.Throws<DomainException>(project.EnsureWritable).Code);
        project.Delete(actor, Now);
        Assert.True(project.IsDeleted);
    }

    [Fact]
    public void Fifth_failed_login_locks_the_user_for_15_minutes()
    {
        // Arrange
        var user = User.Create("Jane@Example.com", "Jane", GlobalRole.User, null, Now);

        // Act
        var locked = Enumerable.Range(0, User.MaxFailedLogins).Select(_ => user.RegisterFailedLogin(Now)).ToList();

        // Assert
        Assert.Equal("jane@example.com", user.Email);
        Assert.Equal([false, false, false, false, true], locked);
        Assert.True(user.IsLockedOut(Now.AddMinutes(14)));
        Assert.False(user.IsLockedOut(Now.AddMinutes(15)));
    }

    [Fact]
    public void Users_cannot_demote_or_deactivate_themselves()
    {
        // Arrange
        var user = User.Create("admin@example.com", "Admin", GlobalRole.Admin, null, Now);

        // Act / Assert
        Assert.Throws<DomainException>(() => user.ChangeRole(GlobalRole.User, user.Id));
        Assert.Throws<DomainException>(() => user.Deactivate(user.Id, Now));
    }

    [Theory]
    [InlineData("not-an-email")]
    [InlineData("a@b@c")]
    [InlineData("")]
    public void Invalid_emails_are_rejected(string email) =>
        Assert.Throws<DomainException>(() => User.Create(email, "Name", GlobalRole.User, null, Now));

    [Theory]
    [InlineData("web-42", "WEB", 42)]
    [InlineData("CORE2-7", "CORE2", 7)]
    public void Ticket_keys_parse_case_insensitively(string key, string project, int number)
    {
        // Act
        var parsed = HumanKeys.TryParseTicket(key, out var projectKey, out var parsedNumber);

        // Assert
        Assert.True(parsed);
        Assert.Equal((project, number), (projectKey, parsedNumber));
    }

    [Fact]
    public void Test_case_and_regression_keys_never_parse_as_ticket_keys()
    {
        // Act / Assert
        Assert.False(HumanKeys.TryParseTicket("WEB-TC-7", out _, out _));
        Assert.True(HumanKeys.TryParseTestCase("web-tc-7", out var project, out var number));
        Assert.Equal(("WEB", 7), (project, number));
        Assert.True(HumanKeys.TryParseRegression("WEB-R-3", out _, out var session));
        Assert.Equal(3, session);
    }

    [Fact]
    public void Relates_to_links_store_the_smaller_id_as_source()
    {
        // Arrange
        var low = Guid.Parse("00000000-0000-7000-8000-000000000001");
        var high = Guid.Parse("00000000-0000-7000-8000-000000000002");

        // Act
        var relates = TicketLink.Create(high, low, TicketLinkType.RelatesTo, Guid.CreateVersion7(), Now);
        var blocks = TicketLink.Create(high, low, TicketLinkType.Blocks, Guid.CreateVersion7(), Now);

        // Assert
        Assert.Equal((low, high), (relates.SourceTicketId, relates.TargetTicketId));
        Assert.Equal((high, low), (blocks.SourceTicketId, blocks.TargetTicketId));
        Assert.Throws<DomainException>(() => TicketLink.Create(low, low, TicketLinkType.Blocks, Guid.CreateVersion7(), Now));
    }
}
