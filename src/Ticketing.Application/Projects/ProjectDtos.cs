using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Projects;

/// <param name="DescriptionPreview">The first <see cref="ListProjects.DescriptionPreviewLength"/> characters of the markdown description.</param>
/// <param name="IsMember">The caller has an explicit membership (the "Mine" filter).</param>
/// <param name="UpdatedAt">The latest ticket update, or the project creation time when it has no tickets.</param>
public sealed record ProjectSummaryDto(
    Guid Id,
    string Key,
    string Name,
    string? DescriptionPreview,
    ProjectVisibility Visibility,
    ProjectRole MyRole,
    bool IsMember,
    int OpenTicketCount,
    TicketCategoryCountsDto TicketCounts,
    ProjectLeadDto? Lead,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? ArchivedAt);

/// <summary>Non-deleted tickets per status category (spec 3), for the project list progress bar.</summary>
public sealed record TicketCategoryCountsDto(int ToDo, int InProgress, int Done);

/// <summary>The longest-standing active Owner member.</summary>
public sealed record ProjectLeadDto(Guid UserId, string DisplayName);

public sealed record ProjectDto(
    Guid Id,
    string Key,
    string Name,
    string? Description,
    ProjectVisibility Visibility,
    ProjectRole MyRole,
    DateTimeOffset? ArchivedAt,
    DateTimeOffset CreatedAt,
    IReadOnlyList<ProjectMemberDto> Members,
    IReadOnlyList<LinkedBoardDto> Boards,
    uint RowVersion);

/// <param name="Role">The stored membership role.</param>
/// <param name="EffectiveRole">
/// What the membership grants (spec 5.1): Admins are Owners everywhere, a Viewer on a public project acts as a Member,
/// deactivated users have no access (null).
/// </param>
public sealed record ProjectMemberDto(
    Guid UserId,
    string Email,
    string DisplayName,
    ProjectRole Role,
    ProjectRole? EffectiveRole,
    bool IsActive,
    GlobalRole GlobalRole,
    DateTimeOffset AddedAt);

public sealed record LinkedBoardDto(Guid Id, string Name);
