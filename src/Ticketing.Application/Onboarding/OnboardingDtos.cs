using Ticketing.Domain.Onboarding;

namespace Ticketing.Application.Onboarding;

/// <summary>Everything the web client needs to decide which guides to offer, in one round trip (D-130).</summary>
/// <param name="Checklist">The getting-started items with their completion, computed from real data (filled by the checklist slice).</param>
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

public sealed record GuideStateDto(string GuideId, int Version, GuideState State, DateTimeOffset UpdatedAt)
{
    public static GuideStateDto From(UserGuideState state) => new(state.GuideId, state.Version, state.State, state.UpdatedAt);
}
