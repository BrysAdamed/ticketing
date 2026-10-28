using Ticketing.Domain.Onboarding;

namespace Ticketing.Application.Onboarding;

/// <summary>Everything the web client needs to decide which guides to offer, in one round trip (D-130).</summary>
/// <param name="Checklist">The getting-started items with their completion, computed from real data, only those meant for the caller's roles.</param>
/// <param name="Guides">The guides the caller completed or dismissed, with the version they saw.</param>
/// <param name="OwnsProjects">Whether the caller owns at least one active project, for owner-only guides and checklist items.</param>
/// <param name="CreatedAt">When the caller's account was created; What's new entries dated before it count as seen.</param>
public sealed record OnboardingDto(
    IReadOnlyList<OnboardingChecklistItemDto> Checklist,
    IReadOnlyList<GuideStateDto> Guides,
    bool OwnsProjects,
    DateTimeOffset CreatedAt);

/// <summary>One getting-started step. New members may be added; existing ones keep their meaning.</summary>
public sealed record OnboardingChecklistItemDto(string Id, bool Done, bool Optional);

/// <summary>The getting-started item ids (spec 14.3, D-133). The web client maps each id to its label and link.</summary>
public static class OnboardingChecklistItems
{
    public const string CreateTicket = "create-ticket";
    public const string MoveWork = "move-work";
    public const string JoinConversation = "join-conversation";
    public const string FollowTicket = "follow-ticket";
    public const string InviteTeam = "invite-team";
    public const string PlanOnBoard = "plan-on-board";
    public const string WriteTestCase = "write-test-case";
    public const string RunRegression = "run-regression";
    public const string AddTeammate = "add-teammate";
    public const string FirstProject = "first-project";
    public const string EnableDelegation = "enable-delegation";
    public const string AgentToken = "agent-token";
    public const string AgentConnected = "agent-connected";
}

public sealed record GuideStateDto(string GuideId, int Version, GuideState State, DateTimeOffset UpdatedAt)
{
    public static GuideStateDto From(UserGuideState state) => new(state.GuideId, state.Version, state.State, state.UpdatedAt);
}
