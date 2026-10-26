using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Projects;

public sealed record ProjectSummaryDto(
    Guid Id,
    string Key,
    string Name,
    ProjectVisibility Visibility,
    ProjectRole MyRole,
    int OpenTicketCount,
    DateTimeOffset? ArchivedAt);

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

public sealed record ProjectMemberDto(Guid UserId, string Email, string DisplayName, ProjectRole Role, bool IsActive, GlobalRole GlobalRole);

public sealed record LinkedBoardDto(Guid Id, string Name);
