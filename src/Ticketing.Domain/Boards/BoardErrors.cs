namespace Ticketing.Domain.Boards;

public static class BoardErrors
{
    public const string NotFound = "board.notFound";
    public const string Archived = "board.archived";
    public const string TooManyProjects = "board.projects.tooMany";
    public const string ProjectNotLinked = "board.project.notLinked";
    public const string NotOwner = "board.notOwner";
    public const string ProjectsRequired = "board.projects.required";
    public const string OwnerInvalid = "board.owner.invalid";
    public const string CarryOverInvalid = "board.carryOver.invalid";
}
