using Ticketing.Application.Tickets;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Docs;

/// <summary>Where a doc goes among its siblings when no before/after key is given.</summary>
public enum DocPosition
{
    Bottom = 1,
    Top = 2,
}

/// <summary>A folder on the way from the project root to a doc.</summary>
public sealed record DocCrumbDto(string Key, string Title);

/// <param name="CanEdit">Create, rename, move, duplicate, edit and publish, hold a draft.</param>
/// <param name="CanDelete">Owners: anything; Members: nodes they created, folders only when empty.</param>
public sealed record DocPermissionsDto(bool CanEdit, bool CanDelete);

/// <summary>Another user with a draft of the doc changed in the last 10 minutes ("Jane is editing").</summary>
public sealed record DocEditorDto(UserRefDto User, DateTimeOffset Since, DateTimeOffset LastActiveAt);

/// <summary>The caller's own unpublished draft of the doc, without its content (fetch it from the draft endpoint).</summary>
public sealed record DocMyDraftDto(int BaseVersion, DateTimeOffset UpdatedAt);

/// <summary>
/// A doc with its latest published content. <see cref="Version"/> is the content version (0 for folders) that content
/// writes send back as <c>baseVersion</c>; <see cref="RowVersion"/> changes on any write (rename and move included).
/// </summary>
public sealed record DocDto(
    Guid Id,
    string Key,
    Guid ProjectId,
    string ProjectKey,
    DocKind Kind,
    DiagramFormat? DiagramFormat,
    string Title,
    string Path,
    string? ParentKey,
    IReadOnlyList<DocCrumbDto> Breadcrumb,
    string? Content,
    int Version,
    UserRefDto CreatedBy,
    DateTimeOffset CreatedAt,
    UserRefDto UpdatedBy,
    DateTimeOffset UpdatedAt,
    ProjectRole MyRole,
    DocPermissionsDto Permissions,
    IReadOnlyList<DocEditorDto> Editors,
    DocMyDraftDto? MyDraft,
    IReadOnlyList<DocTreeItemDto>? Children,
    string Url,
    uint RowVersion);

/// <summary>One node of the flat, depth-first tree (root children have depth 1), in the manual order of each folder.</summary>
public sealed record DocTreeItemDto(
    Guid Id,
    string Key,
    DocKind Kind,
    DiagramFormat? DiagramFormat,
    string Title,
    string? ParentKey,
    int Depth,
    int Version,
    int ChildCount,
    DateTimeOffset UpdatedAt,
    bool HasMyDraft,
    bool CanDelete);

/// <param name="CanManageTrash">Owners only: list the trash and restore anything from it.</param>
public sealed record DocTreeDto(string ProjectKey, ProjectRole MyRole, bool CanWrite, bool CanManageTrash, int Total, IReadOnlyList<DocTreeItemDto> Items);

public sealed record DocSummaryDto(
    Guid Id,
    string Key,
    string ProjectKey,
    DocKind Kind,
    DiagramFormat? DiagramFormat,
    string Title,
    string Path,
    int Version,
    UserRefDto UpdatedBy,
    DateTimeOffset UpdatedAt,
    string Url);

public sealed record DocDraftDto(string DocKey, int BaseVersion, int CurrentVersion, string Title, string Content, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

/// <summary>A group deleted together, shown by its root node; <see cref="Count"/> includes the root.</summary>
public sealed record DocTrashItemDto(
    Guid Id,
    string Key,
    DocKind Kind,
    DiagramFormat? DiagramFormat,
    string Title,
    string FormerPath,
    int Count,
    UserRefDto DeletedBy,
    DateTimeOffset DeletedAt);
