using Ticketing.Domain.Boards;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Tests.Boards;

public sealed class BoardTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);
    private static readonly Guid Owner = Guid.CreateVersion7();
    private static readonly Guid Web = Guid.CreateVersion7();
    private static readonly Guid Api = Guid.CreateVersion7();

    [Fact]
    public void Linking_is_idempotent_and_capped_at_twenty_projects()
    {
        // Arrange
        var board = NewBoard(Web);

        // Act
        board.LinkProject(Web, Owner, Now);
        for (var i = 1; i < Board.MaxProjects; i++)
            board.LinkProject(Guid.CreateVersion7(), Owner, Now);
        var error = Assert.Throws<DomainException>(() => board.LinkProject(Guid.CreateVersion7(), Owner, Now));

        // Assert
        Assert.Equal(Board.MaxProjects, board.Projects.Count);
        Assert.Equal(BoardErrors.TooManyProjects, error.Code);
    }

    [Fact]
    public void The_last_project_cannot_be_unlinked()
    {
        // Arrange
        var board = NewBoard(Web, Api);

        // Act
        board.UnlinkProject(Api);
        var error = Assert.Throws<DomainException>(() => board.UnlinkProject(Web));

        // Assert
        Assert.Equal(BoardErrors.ProjectsRequired, error.Code);
        Assert.True(board.Links(Web));
        Assert.False(board.Links(Api));
    }

    [Fact]
    public void Archived_board_is_read_only_until_unarchived()
    {
        // Arrange
        var board = NewBoard(Web);
        board.Archive(Owner, Now);

        // Act
        var link = Record.Exception(() => board.LinkProject(Api, Owner, Now));
        var archiveAgain = Record.Exception(() => board.Archive(Owner, Now));
        board.Unarchive();
        board.LinkProject(Api, Owner, Now);

        // Assert
        Assert.Equal(BoardErrors.Archived, Assert.IsType<DomainException>(link).Code);
        Assert.Equal(BoardErrors.Archived, Assert.IsType<DomainException>(archiveAgain).Code);
        Assert.False(board.IsArchived);
        Assert.True(board.Links(Api));
    }

    [Fact]
    public void Carry_over_target_must_be_another_active_board()
    {
        // Arrange
        var board = NewBoard(Web);
        var archivedTarget = NewBoard(Web);
        archivedTarget.Archive(Owner, Now);

        // Act
        var self = Assert.Throws<DomainException>(() => board.Archive(Owner, Now, board));
        var archived = Assert.Throws<DomainException>(() => board.Archive(Owner, Now, archivedTarget));

        // Assert
        Assert.Equal((BoardErrors.CarryOverInvalid, "carryOverTo"), (self.Code, self.Field));
        Assert.Equal(BoardErrors.CarryOverInvalid, archived.Code);
        Assert.False(board.IsArchived);
    }

    [Fact]
    public void Ownership_goes_only_to_active_users()
    {
        // Arrange
        var board = NewBoard(Web);
        var other = Guid.CreateVersion7();

        // Act
        var error = Assert.Throws<DomainException>(() => board.TransferOwnership(other, newOwnerIsActive: false));
        board.TransferOwnership(other, newOwnerIsActive: true);

        // Assert
        Assert.Equal(BoardErrors.OwnerInvalid, error.Code);
        Assert.Equal(other, board.OwnerId);
    }

    [Fact]
    public void Carry_over_keeps_done_tickets_and_sends_the_rest_to_the_target_or_backlog_in_board_order()
    {
        // Arrange
        var target = NewBoard(Web);
        BoardTicket[] tickets =
        [
            new(Guid.CreateVersion7(), Web, TicketStatus.InProgress),
            new(Guid.CreateVersion7(), Api, TicketStatus.ToDo),
            new(Guid.CreateVersion7(), Web, TicketStatus.Done),
            new(Guid.CreateVersion7(), Web, TicketStatus.Review),
            new(Guid.CreateVersion7(), Api, TicketStatus.Testing),
        ];

        // Act
        var plan = BoardCarryOver.Plan(tickets, target);

        // Assert
        Assert.Equal([tickets[2].Id], plan.Stay);
        Assert.Equal([tickets[0].Id, tickets[3].Id], plan.ToBoard);
        Assert.Equal([tickets[1].Id, tickets[4].Id], plan.ToBacklogs[Api]);
        Assert.False(plan.ToBacklogs.ContainsKey(Web));
        Assert.Equal(2, plan.ToBacklogCount);
    }

    [Fact]
    public void Carry_over_to_backlogs_groups_open_tickets_by_project()
    {
        // Arrange
        BoardTicket[] tickets =
        [
            new(Guid.CreateVersion7(), Web, TicketStatus.ToDo),
            new(Guid.CreateVersion7(), Api, TicketStatus.Done),
            new(Guid.CreateVersion7(), Web, TicketStatus.OnHold),
        ];

        // Act
        var archive = BoardCarryOver.Plan(tickets, target: null);
        var delete = BoardCarryOver.Evacuate(tickets);

        // Assert
        Assert.Equal([tickets[0].Id, tickets[2].Id], archive.ToBacklogs[Web]);
        Assert.Equal([tickets[1].Id], archive.Stay);
        Assert.Empty(archive.ToBoard);
        Assert.Equal([tickets[1].Id], delete.ToBacklogs[Api]);
        Assert.Equal(3, delete.ToBacklogCount);
        Assert.Empty(delete.Stay);
    }

    private static Board NewBoard(params Guid[] projects)
    {
        var board = Board.Create("Sprint 42", null, Owner, Now);
        foreach (var project in projects)
            board.LinkProject(project, Owner, Now);
        return board;
    }
}
