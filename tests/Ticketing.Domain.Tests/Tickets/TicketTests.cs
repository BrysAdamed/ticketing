using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Tests.Tickets;

public sealed class TicketTests
{
    private static readonly DateTimeOffset Created = new(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Later = Created.AddHours(5);
    private static readonly Guid ProjectId = Guid.CreateVersion7();

    [Fact]
    public void New_ticket_has_spec_defaults()
    {
        // Act
        var ticket = NewTicket();

        // Assert
        Assert.Equal((TicketStatus.ToDo, Priority.Medium, (Resolution?)null), (ticket.Status, ticket.Priority, ticket.Resolution));
        Assert.Equal(ticket.CreatedById, ticket.ReporterId);
        Assert.True(ticket.IsInBacklog);
        Assert.Equal("WEB-7", ticket.KeyIn("WEB"));
    }

    [Fact]
    public void Entering_done_sets_resolved_at_and_default_resolution()
    {
        // Arrange
        var ticket = NewTicket();

        // Act
        var change = ticket.ChangeStatus(TicketStatus.Done, null, Later);

        // Assert
        Assert.True(change.EntersDone);
        Assert.Equal((Resolution.Done, Later, Later), (ticket.Resolution, ticket.ResolvedAt, ticket.StatusChangedAt));
    }

    [Fact]
    public void Entering_done_keeps_a_given_resolution()
    {
        // Arrange
        var ticket = NewTicket();

        // Act
        ticket.ChangeStatus(TicketStatus.Done, Resolution.WontDo, Later);

        // Assert
        Assert.Equal(Resolution.WontDo, ticket.Resolution);
    }

    [Fact]
    public void Leaving_done_clears_resolution_and_resolved_at()
    {
        // Arrange
        var ticket = NewTicket();
        ticket.ChangeStatus(TicketStatus.Done, Resolution.Duplicate, Created.AddHours(1));

        // Act
        var change = ticket.ChangeStatus(TicketStatus.Review, null, Later);

        // Assert
        Assert.True(change.LeavesDone);
        Assert.Equal(((Resolution?)null, (DateTimeOffset?)null, Later), (ticket.Resolution, ticket.ResolvedAt, ticket.StatusChangedAt));
    }

    [Fact]
    public void Any_status_can_move_to_any_other()
    {
        // Arrange
        var ticket = NewTicket();

        // Act
        foreach (var status in Enum.GetValues<TicketStatus>().Reverse())
            ticket.ChangeStatus(status, null, Later);

        // Assert
        Assert.Equal(TicketStatus.ToDo, ticket.Status);
    }

    [Fact]
    public void Same_status_does_not_touch_status_changed_at()
    {
        // Arrange
        var ticket = NewTicket();

        // Act
        var change = ticket.ChangeStatus(TicketStatus.ToDo, null, Later);

        // Assert
        Assert.False(change.Changed);
        Assert.Equal(Created, ticket.StatusChangedAt);
    }

    [Fact]
    public void Resolution_without_done_is_rejected()
    {
        // Arrange
        var ticket = NewTicket();

        // Act
        var error = Assert.Throws<DomainException>(() => ticket.ChangeStatus(TicketStatus.Testing, Resolution.WontDo, Later));

        // Assert
        Assert.Equal((TicketErrors.ResolutionWithoutDone, DomainErrorKind.Validation), (error.Code, error.Kind));
    }

    [Theory]
    [InlineData(TicketStatus.ToDo, StatusCategory.ToDo)]
    [InlineData(TicketStatus.OnHold, StatusCategory.InProgress)]
    [InlineData(TicketStatus.ReadyForDeploy, StatusCategory.InProgress)]
    [InlineData(TicketStatus.Done, StatusCategory.Done)]
    public void Status_category_is_derived(TicketStatus status, StatusCategory expected) => Assert.Equal(expected, status.Category());

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("two\nlines")]
    public void Title_must_be_a_non_empty_single_line(string title) =>
        Assert.Throws<DomainException>(() => Ticket.Create(ProjectId, 1, title, TicketType.Bug, Guid.CreateVersion7(), "a0", Created));

    [Fact]
    public void Title_is_trimmed() =>
        Assert.Equal("Fix login", Ticket.Create(ProjectId, 1, "  Fix login ", TicketType.Bug, Guid.CreateVersion7(), "a0", Created).Title);

    [Theory]
    [InlineData(-1)]
    [InlineData(101)]
    public void Story_points_are_limited_to_0_to_100(int points) =>
        Assert.Equal(TicketErrors.StoryPointsOutOfRange, Assert.Throws<DomainException>(() => NewTicket().ChangeStoryPoints(points)).Code);

    [Fact]
    public void Delete_removes_the_ticket_from_its_board()
    {
        // Arrange
        var ticket = NewTicket();
        ticket.PlaceOnBoard(Guid.CreateVersion7(), "a0");

        // Act
        ticket.Delete(Guid.CreateVersion7(), Later);

        // Assert
        Assert.True(ticket.IsDeleted);
        Assert.True(ticket.IsInBacklog);
    }

    [Fact]
    public void Restore_within_the_window_clears_the_deletion()
    {
        // Arrange
        var ticket = NewTicket();
        ticket.Delete(Guid.CreateVersion7(), Later);

        // Act
        ticket.Restore(Later + Ticket.RestoreWindow);

        // Assert
        Assert.False(ticket.IsDeleted);
        Assert.Null(ticket.DeletedById);
    }

    [Fact]
    public void Restore_after_the_window_is_rejected()
    {
        // Arrange
        var ticket = NewTicket();
        ticket.Delete(Guid.CreateVersion7(), Later);

        // Act
        var error = Assert.Throws<DomainException>(() => ticket.Restore(Later + Ticket.RestoreWindow + TimeSpan.FromSeconds(1)));

        // Assert
        Assert.Equal((TicketErrors.RestoreExpired, DomainErrorKind.Conflict), (error.Code, error.Kind));
        Assert.True(ticket.IsDeleted);
    }

    [Fact]
    public void Restore_of_a_ticket_that_is_not_deleted_is_rejected()
    {
        // Arrange
        var ticket = NewTicket();

        // Act
        var error = Assert.Throws<DomainException>(() => ticket.Restore(Later));

        // Assert
        Assert.Equal((TicketErrors.NotDeleted, DomainErrorKind.Conflict), (error.Code, error.Kind));
    }

    internal static Ticket NewTicket(TicketType type = TicketType.UserStory, Guid? projectId = null) =>
        Ticket.Create(projectId ?? ProjectId, 7, "Fix login", type, Guid.CreateVersion7(), "a0", Created);
}
