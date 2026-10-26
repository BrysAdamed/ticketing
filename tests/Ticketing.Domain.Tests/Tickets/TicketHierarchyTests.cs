using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Tests.Tickets;

public sealed class TicketHierarchyTests
{
    [Fact]
    public void Story_under_epic_is_allowed()
    {
        // Arrange
        var epic = TicketTests.NewTicket(TicketType.Epic);
        var story = TicketTests.NewTicket(TicketType.UserStory);

        // Act
        story.SetParent(epic, [], subtreeHeight: 1);

        // Assert
        Assert.Equal(epic.Id, story.ParentId);
    }

    [Fact]
    public void Third_level_is_allowed_and_fourth_is_rejected_with_depth()
    {
        // Arrange
        var epic = TicketTests.NewTicket(TicketType.Epic);
        var story = TicketTests.NewTicket();
        var task = TicketTests.NewTicket(TicketType.Technical);
        var spike = TicketTests.NewTicket(TicketType.Spike);
        story.SetParent(epic, [], 1);
        task.SetParent(story, [epic.Id], 1);

        // Act
        var error = Assert.Throws<DomainException>(() => spike.SetParent(task, [story.Id, epic.Id], 1));

        // Assert
        Assert.Equal(TicketErrors.ParentDepth, error.Code);
        Assert.Equal("parentKey", error.Field);
        Assert.NotNull(error.Hint);
    }

    [Fact]
    public void Moving_a_subtree_counts_its_height()
    {
        // Arrange
        var epic = TicketTests.NewTicket(TicketType.Epic);
        var story = TicketTests.NewTicket();
        var storyWithChildren = TicketTests.NewTicket();
        story.SetParent(epic, [], 1);

        // Act
        var error = Assert.Throws<DomainException>(() => storyWithChildren.SetParent(story, [epic.Id], subtreeHeight: 2));

        // Assert
        Assert.Equal(TicketErrors.ParentDepth, error.Code);
    }

    [Fact]
    public void Descendant_as_parent_is_a_cycle()
    {
        // Arrange
        var parent = TicketTests.NewTicket();
        var child = TicketTests.NewTicket();
        child.SetParent(parent, [], 1);

        // Act
        var error = Assert.Throws<DomainException>(() => parent.SetParent(child, [parent.Id], 2));

        // Assert
        Assert.Equal(TicketErrors.ParentCycle, error.Code);
    }

    [Fact]
    public void Self_as_parent_is_a_cycle()
    {
        // Arrange
        var ticket = TicketTests.NewTicket();

        // Act / Assert
        Assert.Equal(TicketErrors.ParentCycle, Assert.Throws<DomainException>(() => ticket.SetParent(ticket, [], 1)).Code);
    }

    [Fact]
    public void Epic_cannot_have_a_parent()
    {
        // Arrange
        var epic = TicketTests.NewTicket(TicketType.Epic);
        var other = TicketTests.NewTicket(TicketType.Epic);

        // Act / Assert
        Assert.Equal(TicketErrors.EpicCannotHaveParent, Assert.Throws<DomainException>(() => epic.SetParent(other, [], 1)).Code);
    }

    [Fact]
    public void Parent_must_be_in_the_same_project()
    {
        // Arrange
        var parent = TicketTests.NewTicket(projectId: Guid.CreateVersion7());
        var child = TicketTests.NewTicket();

        // Act / Assert
        Assert.Equal(TicketErrors.ParentOtherProject, Assert.Throws<DomainException>(() => child.SetParent(parent, [], 1)).Code);
    }

    [Fact]
    public void Ticket_with_a_parent_cannot_become_an_epic()
    {
        // Arrange
        var parent = TicketTests.NewTicket();
        var child = TicketTests.NewTicket();
        child.SetParent(parent, [], 1);

        // Act / Assert
        Assert.Throws<DomainException>(() => child.ChangeType(TicketType.Epic));
        child.ClearParent();
        child.ChangeType(TicketType.Epic);
        Assert.Equal(TicketType.Epic, child.Type);
    }
}
