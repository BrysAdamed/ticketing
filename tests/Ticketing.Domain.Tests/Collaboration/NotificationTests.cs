using Ticketing.Domain.Collaboration;

namespace Ticketing.Domain.Tests.Collaboration;

public sealed class NotificationTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 27, 9, 0, 0, TimeSpan.Zero);
    private static readonly Guid Recipient = Guid.CreateVersion7();
    private static readonly Guid Actor = Guid.CreateVersion7();
    private static readonly Guid Project = Guid.CreateVersion7();
    private static readonly Guid Ticket = Guid.CreateVersion7();

    [Fact]
    public void A_new_notification_counts_one_unread_event()
    {
        // Act
        var notification = Notification.AboutTicket(Recipient, Project, Ticket, Actor, NotificationKind.Commented, "commented", Now);

        // Assert
        Assert.Equal((1, Now, Now, (DateTimeOffset?)null), (notification.EventCount, notification.CreatedAt, notification.UpdatedAt, notification.ReadAt));
        Assert.Equal((Ticket, (Guid?)null, (string?)null), (notification.TicketId!.Value, notification.RegressionSessionId, notification.TestCaseKey));
    }

    [Fact]
    public void Merging_a_higher_ranked_event_replaces_the_headline()
    {
        // Arrange
        var notification = Notification.AboutTicket(Recipient, Project, Ticket, Actor, NotificationKind.Commented, "commented", Now);

        // Act
        notification.Merge(NotificationKind.StatusChanged, "changed the status to Review", Now.AddMinutes(1));
        notification.Merge(NotificationKind.Moved, "moved the ticket to the backlog", Now.AddMinutes(2));

        // Assert
        Assert.Equal(NotificationKind.StatusChanged, notification.Kind);
        Assert.Equal("changed the status to Review", notification.Summary);
        Assert.Equal(3, notification.EventCount);
        Assert.Equal((Now, Now.AddMinutes(2)), (notification.CreatedAt, notification.UpdatedAt));
    }

    [Fact]
    public void Headline_ranks_follow_the_documented_order()
    {
        // Arrange
        NotificationKind[] expected =
        [
            NotificationKind.Mentioned, NotificationKind.Assigned, NotificationKind.RegressionItemAssigned, NotificationKind.Deleted,
            NotificationKind.StatusChanged, NotificationKind.PriorityRaised, NotificationKind.Commented, NotificationKind.Moved,
        ];

        // Act
        var ordered = Enum.GetValues<NotificationKind>().OrderByDescending(Notification.Rank).ToArray();

        // Assert
        Assert.Equal(expected, ordered);
    }

    [Fact]
    public void Merging_an_equal_or_lower_ranked_event_keeps_the_first_summary()
    {
        // Arrange
        var notification = Notification.AboutTicket(Recipient, Project, Ticket, Actor, NotificationKind.StatusChanged, "changed the status to Review", Now);

        // Act
        notification.Merge(NotificationKind.StatusChanged, "changed the status to Done", Now.AddMinutes(1));

        // Assert
        Assert.Equal(("changed the status to Review", 2), (notification.Summary, notification.EventCount));
    }

    [Fact]
    public void Absorbs_only_unread_events_of_the_same_key_within_five_minutes_of_the_first()
    {
        // Arrange
        var notification = Notification.AboutTicket(Recipient, Project, Ticket, Actor, NotificationKind.Commented, "commented", Now);
        var read = Notification.AboutTicket(Recipient, Project, Ticket, Actor, NotificationKind.Commented, "commented", Now);
        read.MarkRead(Now.AddSeconds(5));

        // Act
        var results = new[]
        {
            notification.Absorbs(Recipient, Actor, Ticket, null, Now.AddMinutes(5)),
            notification.Absorbs(Recipient, Actor, Ticket, null, Now.AddMinutes(5).AddTicks(1)),
            notification.Absorbs(Recipient, Guid.CreateVersion7(), Ticket, null, Now.AddMinutes(1)),
            notification.Absorbs(Recipient, null, Ticket, null, Now.AddMinutes(1)),
            notification.Absorbs(Guid.CreateVersion7(), Actor, Ticket, null, Now.AddMinutes(1)),
            notification.Absorbs(Recipient, Actor, Guid.CreateVersion7(), null, Now.AddMinutes(1)),
            read.Absorbs(Recipient, Actor, Ticket, null, Now.AddMinutes(1)),
        };

        // Assert
        Assert.Equal([true, false, false, false, false, false, false], results);
    }

    [Fact]
    public void Mark_read_keeps_the_first_read_time()
    {
        // Arrange
        var notification = Notification.AboutRegressionItem(Recipient, Project, Guid.CreateVersion7(), "WEB-TC-1", Actor, NotificationKind.RegressionItemAssigned, "assigned you WEB-TC-1", Now);

        // Act
        notification.MarkRead(Now.AddMinutes(1));
        notification.MarkRead(Now.AddMinutes(2));

        // Assert
        Assert.Equal(Now.AddMinutes(1), notification.ReadAt);
    }

    [Fact]
    public void Long_summaries_are_clipped_and_empty_ones_rejected()
    {
        // Act
        var clipped = Notification.AboutTicket(Recipient, Project, Ticket, Actor, NotificationKind.Moved, new string('x', 400), Now);
        var empty = Record.Exception(() => Notification.AboutTicket(Recipient, Project, Ticket, Actor, NotificationKind.Moved, " ", Now));
        var noTicket = Record.Exception(() => Notification.AboutTicket(Recipient, Project, Guid.Empty, Actor, NotificationKind.Moved, "moved", Now));
        var noRecipient = Record.Exception(() => Notification.AboutTicket(Guid.Empty, Project, Ticket, Actor, NotificationKind.Moved, "moved", Now));

        // Assert
        Assert.Equal(Notification.SummaryMaxLength, clipped.Summary.Length);
        Assert.EndsWith("…", clipped.Summary, StringComparison.Ordinal);
        Assert.IsType<ArgumentException>(empty);
        Assert.IsType<ArgumentException>(noTicket);
        Assert.IsType<ArgumentException>(noRecipient);
    }
}
