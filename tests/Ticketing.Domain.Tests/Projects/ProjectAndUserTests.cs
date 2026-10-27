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

        var other = Guid.CreateVersion7();

        // Act
        var error = Assert.Throws<DomainException>(() => project.RemoveMember(creator, Active(creator)));
        project.AddMember(other, ProjectRole.Owner, creator, Now);
        var previous = project.ChangeMemberRole(creator, ProjectRole.Member, Active(creator, other));

        // Assert
        Assert.Equal(ProjectErrors.LastOwner, error.Code);
        Assert.Equal(ProjectRole.Owner, previous);
        Assert.Equal(ProjectRole.Member, project.Members.Single(m => m.UserId == creator).Role);
    }

    [Fact]
    public void A_deactivated_owner_does_not_count_as_the_remaining_owner()
    {
        // Arrange
        var creator = Guid.CreateVersion7();
        var deactivated = Guid.CreateVersion7();
        var project = Project.Create("WEB", "Website", null, ProjectVisibility.Private, creator, Now);
        project.AddMember(deactivated, ProjectRole.Owner, creator, Now);

        // Act
        var demote = Assert.Throws<DomainException>(() => project.ChangeMemberRole(creator, ProjectRole.Viewer, Active(creator)));
        var remove = Assert.Throws<DomainException>(() => project.RemoveMember(creator, Active(creator)));
        project.RemoveMember(deactivated, Active(creator));

        // Assert
        Assert.Equal((ProjectErrors.LastOwner, ProjectErrors.LastOwner), (demote.Code, remove.Code));
        Assert.Equal([creator], project.Members.Select(m => m.UserId));
    }

    [Fact]
    public void Members_cannot_be_added_twice_or_changed_on_an_archived_project()
    {
        // Arrange
        var creator = Guid.CreateVersion7();
        var member = Guid.CreateVersion7();
        var project = Project.Create("WEB", "Website", null, ProjectVisibility.Private, creator, Now);
        project.AddMember(member, ProjectRole.Viewer, creator, Now);

        // Act
        var duplicate = Assert.Throws<DomainException>(() => project.AddMember(member, ProjectRole.Member, creator, Now));
        project.Archive(creator, Now);
        var archivedAdd = Assert.Throws<DomainException>(() => project.AddMember(Guid.CreateVersion7(), ProjectRole.Member, creator, Now));
        var archivedRole = Assert.Throws<DomainException>(() => project.ChangeMemberRole(member, ProjectRole.Member, Active(creator, member)));
        var archivedRemove = Assert.Throws<DomainException>(() => project.RemoveMember(member, Active(creator, member)));

        // Assert
        Assert.Equal(ProjectErrors.AlreadyMember, duplicate.Code);
        Assert.All([archivedAdd, archivedRole, archivedRemove], e => Assert.Equal(ProjectErrors.Archived, e.Code));
    }

    [Fact]
    public void Only_archived_projects_can_be_deleted_and_only_with_the_typed_key()
    {
        // Arrange
        var actor = Guid.CreateVersion7();
        var project = Project.Create("WEB", "Website", null, ProjectVisibility.Private, actor, Now);

        // Act / Assert
        Assert.Equal(ProjectErrors.NotArchived, Assert.Throws<DomainException>(() => project.Delete(actor, Now, "WEB")).Code);
        project.Archive(actor, Now);
        Assert.Equal(ProjectErrors.Archived, Assert.Throws<DomainException>(project.EnsureWritable).Code);
        Assert.Equal(ProjectErrors.DeleteNotConfirmed, Assert.Throws<DomainException>(() => project.Delete(actor, Now, "web")).Code);
        project.Delete(actor, Now, " WEB ");
        Assert.True(project.IsDeleted);
    }

    [Fact]
    public void Unarchive_keeps_members_when_an_active_owner_remains()
    {
        // Arrange
        var owner = Guid.CreateVersion7();
        var project = Project.Create("WEB", "Website", null, ProjectVisibility.Private, owner, Now);
        project.Archive(owner, Now);

        // Act
        var restored = project.Unarchive(owner, Now, Active(owner));

        // Assert
        Assert.Null(restored);
        Assert.False(project.IsArchived);
        Assert.Equal(ProjectErrors.NotArchived, Assert.Throws<DomainException>(() => project.Unarchive(owner, Now, Active(owner))).Code);
    }

    [Fact]
    public void Unarchive_without_an_active_owner_makes_the_acting_admin_an_owner()
    {
        // Arrange
        var deactivatedOwner = Guid.CreateVersion7();
        var admin = Guid.CreateVersion7();
        var project = Project.Create("WEB", "Website", null, ProjectVisibility.Private, deactivatedOwner, Now);
        project.Archive(deactivatedOwner, Now);

        // Act
        var restored = project.Unarchive(admin, Now, Active());

        // Assert
        Assert.Equal((admin, ProjectRole.Owner), (restored?.UserId, restored?.Role));
        Assert.Equal(2, project.Members.Count);
    }

    [Fact]
    public void Fifth_failed_login_from_one_address_locks_that_pair_for_15_minutes()
    {
        // Arrange
        var user = User.Create("Jane@Example.com", "Jane", GlobalRole.User, null, Now);
        var throttle = LoginThrottle.Create(user.Id, "203.0.113.7");

        // Act
        var locked = Enumerable.Range(0, LoginThrottle.MaxFailedLogins).Select(_ => throttle.RegisterFailure(Now)).ToList();

        // Assert
        Assert.Equal("jane@example.com", user.Email);
        Assert.Equal([false, false, false, false, true], locked);
        Assert.True(throttle.IsLockedOut(Now.AddMinutes(14)));
        Assert.False(throttle.IsLockedOut(Now.AddMinutes(15)));
        Assert.Equal(0, throttle.FailedCount);
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

    private static HashSet<Guid> Active(params Guid[] userIds) => [.. userIds];
}
