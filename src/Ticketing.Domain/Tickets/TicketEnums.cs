namespace Ticketing.Domain.Tickets;

public enum TicketType
{
    Epic = 1,
    UserStory = 2,
    Technical = 3,
    Spike = 4,
    Bug = 5,
}

public enum TicketStatus
{
    ToDo = 1,
    InProgress = 2,
    OnHold = 3,
    Review = 4,
    ReadyForTesting = 5,
    Testing = 6,
    ReadyForDeploy = 7,
    Done = 8,
}

public enum StatusCategory
{
    ToDo = 1,
    InProgress = 2,
    Done = 3,
}

public enum Resolution
{
    Done = 1,
    WontDo = 2,
    Duplicate = 3,
    CannotReproduce = 4,
}

public enum Priority
{
    Highest = 1,
    High = 2,
    Medium = 3,
    Low = 4,
    Lowest = 5,
}

public enum Severity
{
    Blocker = 1,
    Critical = 2,
    Major = 3,
    Minor = 4,
    Trivial = 5,
}

public enum TicketLinkType
{
    Blocks = 1,
    RelatesTo = 2,
    Duplicates = 3,
}

public static class TicketStatusExtensions
{
    public static StatusCategory Category(this TicketStatus status) => status switch
    {
        TicketStatus.ToDo => StatusCategory.ToDo,
        TicketStatus.Done => StatusCategory.Done,
        _ => StatusCategory.InProgress,
    };

    public static bool IsOpen(this TicketStatus status) => status != TicketStatus.Done;
}
