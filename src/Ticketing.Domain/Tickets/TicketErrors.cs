namespace Ticketing.Domain.Tickets;

public static class TicketErrors
{
    public const string NotFound = "ticket.notFound";
    public const string ParentCycle = "ticket.parent.cycle";
    public const string ParentDepth = "ticket.parent.depth";
    public const string ParentOtherProject = "ticket.parent.otherProject";
    public const string EpicCannotHaveParent = "ticket.parent.epic";
    public const string HasChildren = "ticket.hasChildren";
    public const string LabelsInvalid = "ticket.labels.invalid";
    public const string LabelsTooMany = "ticket.labels.tooMany";
    public const string StoryPointsOutOfRange = "ticket.storyPoints.range";
    public const string ResolutionWithoutDone = "ticket.resolution.notDone";
    public const string Deleted = "ticket.deleted";
    public const string LinkSelf = "ticket.link.self";
    public const string LinkExists = "ticket.link.exists";
}
