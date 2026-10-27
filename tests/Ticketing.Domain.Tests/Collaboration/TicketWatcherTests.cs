using Ticketing.Domain.Collaboration;

namespace Ticketing.Domain.Tests.Collaboration;

public sealed class TicketWatcherTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 27, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Create_keeps_ticket_user_and_time()
    {
        // Arrange
        var ticketId = Guid.CreateVersion7();
        var userId = Guid.CreateVersion7();

        // Act
        var watcher = TicketWatcher.Create(ticketId, userId, Now);

        // Assert
        Assert.Equal((ticketId, userId, Now), (watcher.TicketId, watcher.UserId, watcher.CreatedAt));
    }

    [Fact]
    public void Create_needs_a_ticket_and_a_user()
    {
        // Act
        var noTicket = Record.Exception(() => TicketWatcher.Create(Guid.Empty, Guid.CreateVersion7(), Now));
        var noUser = Record.Exception(() => TicketWatcher.Create(Guid.CreateVersion7(), Guid.Empty, Now));

        // Assert
        Assert.IsType<ArgumentException>(noTicket);
        Assert.IsType<ArgumentException>(noUser);
    }
}
