namespace Ticketing.Domain.Achievements;

/// <summary>
/// Every achievement that can be earned (spec 15.2, D-145). The catalogue is code, not data: adding an achievement is an entry
/// here plus its criterion in <c>Ticketing.Application/Achievements/Criteria</c> (backend.md, "Adding an achievement").
/// Ids are stored with earned tiers, so an id is never renamed or reused.
/// </summary>
public static class AchievementCatalog
{
    public const string Reporter = "reporter";
    public const string Closer = "closer";
    public const string ReadyForReview = "ready-for-review";
    public const string BugHunter = "bug-hunter";
    public const string Exterminator = "exterminator";
    public const string Conversationalist = "conversationalist";
    public const string Connector = "connector";
    public const string ShowMe = "show-me";
    public const string Triage = "triage";
    public const string TestAuthor = "test-author";
    public const string RegressionRunner = "regression-runner";
    public const string FoundIt = "found-it";
    public const string FullSweep = "full-sweep";
    public const string BoardBuilder = "board-builder";
    public const string SpringCleaning = "spring-cleaning";
    public const string Delegator = "delegator";
    public const string MachineWhisperer = "machine-whisperer";
    public const string EpicFinisher = "epic-finisher";
    public const string ShoutOut = "shout-out";
    public const string SecondThoughts = "second-thoughts";
    public const string Unblocker = "unblocker";
    public const string GrandTour = "grand-tour";

    private static readonly int[] Once = [1];

    public static IReadOnlyList<AchievementDefinition> All { get; } =
    [
        new(Reporter, "Reporter", "Created tickets.", "Create a ticket in any project.", "file-plus", [1, 10, 50, 250]),
        new(Closer, "Closer", "Moved tickets to Done.", "Move a ticket to Done.", "circle-check", [1, 10, 50, 250]),
        new(ReadyForReview, "Ready for review", "Moved tickets to Review.", "Move a ticket you worked on to Review.", "git-pull-request", [1, 10, 50, 250]),
        new(BugHunter, "Bug hunter", "Reported bugs.", "Create a ticket of type Bug.", "bug", [1, 10, 50]),
        new(Exterminator, "Exterminator", "Moved bugs to Done.", "Move a Bug to Done.", "bug-off", [1, 10, 50]),
        new(Conversationalist, "Conversationalist", "Wrote comments on tickets and docs.", "Comment on a ticket or a doc.", "messages", [1, 25, 100, 500]),
        new(Connector, "Connector", "Linked tickets.", "Link a ticket to another one (blocks, relates to, duplicates).", "link", [1, 10, 50]),
        new(ShowMe, "Show me", "Attached files to tickets and docs.", "Attach a screenshot or a file to a ticket or a doc.", "paperclip", [1, 10]),
        new(Triage, "Triage", "Assigned tickets to teammates.", "Assign a ticket to a teammate, when creating it or later.", "user-share", [10, 50, 200]),
        new(TestAuthor, "Test author", "Wrote test cases.", "Create a test case in a project's Testing tab.", "test-pipe", [1, 10, 50]),
        new(RegressionRunner, "Regression runner", "Recorded regression results.", "Record a result for a test case in a regression session.", "checklist", [10, 100, 500]),
        new(FoundIt, "Found it", "Filed bugs from failed regression items.", "File a bug from a failed item in a regression session.", "zoom-exclamation", [1, 10]),
        new(FullSweep, "Full sweep", "Completed regression sessions.", "Complete a regression session.", "list-check", [1, 5, 25]),
        new(BoardBuilder, "Board builder", "Created a board.", "Create a board for your team's work.", "layout-kanban", Once),
        new(SpringCleaning, "Spring cleaning", "Archived a board.", "Archive a board when its work is finished.", "archive", Once),
        new(Delegator, "Delegator", "Delegated tickets to an agent.", "Delegate a ticket to an agent from its menu.", "robot", [1, 10, 50]),
        new(MachineWhisperer, "Machine whisperer", "Made a change through MCP.", "Connect an AI agent over MCP and let it change something for you.", "plug-connected", Once),
        new(EpicFinisher, "Epic finisher", "Closed an Epic with all of its work done.", "Move an Epic to Done once every ticket in it is Done.", "flag-check", Once),
        new(ShoutOut, "Shout-out", "Mentioned a teammate.", "Mention a teammate with @ in a comment, a ticket description or a page.", "speakerphone", Once),
        new(SecondThoughts, "Second thoughts", "Undid your own delete.", null, "arrow-back-up", Once, secret: true),
        new(Unblocker, "Unblocker", "Finished a ticket that was blocking three open tickets.", null, "lock-open", Once, secret: true),
        new(GrandTour, "Grand tour", "Worked on a ticket that went through all eight statuses.", null, "route", Once, secret: true),
    ];

    public static AchievementDefinition? Find(string id) => All.FirstOrDefault(a => a.Id == id);
}
