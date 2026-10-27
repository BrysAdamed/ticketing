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
