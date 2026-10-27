namespace Ticketing.Domain.Agents;

/// <summary>
/// A project's agent setup (spec 13.3). <see cref="AssignOnDelegate"/> and <see cref="StartProgressOnDelegate"/> say what
/// clicking Delegate does to the ticket: assign it to the delegating user when unassigned, and move it from ToDo to InProgress.
/// </summary>
public sealed record AgentDelegationSettings(
    bool Enabled,
    string? RepositoryUrl,
    string DefaultBranch,
    AgentMergePolicy MergePolicy,
    bool AssignOnDelegate,
    bool StartProgressOnDelegate)
{
    public static readonly AgentDelegationSettings Default = new(false, null, GitBranchName.Default, AgentMergePolicy.Review, true, true);
}
