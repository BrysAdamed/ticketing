namespace Ticketing.Domain.Agents;

public enum AgentPromptScope
{
    Instance = 1,
    Project = 2,
}

/// <summary>How a project handles a ticket type. Instance rows are always <see cref="Custom"/>.</summary>
public enum AgentPromptMode
{
    Inherit = 1,
    Custom = 2,
    Off = 3,
}

/// <summary>Where the type template of a resolved prompt came from.</summary>
public enum AgentPromptSource
{
    Default = 1,
    Custom = 2,
}

/// <summary>How far a delegated run may go: stop at a pushed branch in Review, or merge to main once verified (per-project opt-in).</summary>
public enum AgentMergePolicy
{
    Review = 1,
    MergeWhenVerified = 2,
}

/// <summary>
/// Which text the agent reads that an outsider wrote (D-100, D-104, D-106): on the ticket itself, anything on a related
/// (parent, child or linked) ticket, or one of the ticket's test cases.
/// </summary>
public enum AgentPromptContentSource
{
    Description = 1,
    Comment = 2,
    Title = 3,
    Attachment = 4,
    RelatedTicket = 5,
    TestCase = 6,
}

/// <summary>The Claude app a delegation opened: Claude Code in a terminal (<c>claude-cli://open</c>) or Claude Desktop (<c>claude://code/new</c>).</summary>
public enum AgentApp
{
    ClaudeCode = 1,
    ClaudeDesktop = 2,
}