using System.Text.Json;
using Ticketing.Application.Tickets;
using Ticketing.Application.Watchers;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;

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
/// <see cref="CommentCount"/> counts the comments that are not deleted (always 0 for folders).
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
    uint RowVersion,
    int CommentCount,
    DocReferencesDto References,
    IReadOnlyList<DocEmbedDto> Embeds,
    DocMentionsDto Backlinks)
{
    /// <summary>Set when an older version was asked for: <see cref="Content"/> is then that version's; everything else describes the doc now.</summary>
    public DocVersionInfoDto? AtVersion { get; init; }

    /// <summary>Canvas only: the labels and connector relations of <see cref="Content"/>, one per line (<c>API → DB</c>).</summary>
    public string? Outline { get; init; }

    /// <summary>Canvas only: where the SVG picture of the shown version is served; null while that version has none.</summary>
    public string? SnapshotUrl { get; init; }

    /// <summary>Pages and diagrams: the visible watchers and whether the caller watches (D-162); null for folders.</summary>
    public WatchersDto? Watchers { get; init; }
}

/// <summary>What the latest content mentions, resolved for the reader: tickets and docs the reader cannot read are left out.</summary>
public sealed record DocReferencesDto(IReadOnlyList<DocTicketReferenceDto> Tickets, IReadOnlyList<DocLinkReferenceDto> Docs)
{
    public static readonly DocReferencesDto Empty = new([], []);
}

/// <summary>A mentioned ticket (not deleted, readable) with what a ticket chip shows.</summary>
public sealed record DocTicketReferenceDto(Guid Id, string Key, string Title, TicketType Type, TicketStatus Status, string Url);

/// <summary>A mentioned or linked doc; a deleted one carries only its key (rendered "KEY (deleted)"), no title or url.</summary>
public sealed record DocLinkReferenceDto(
    Guid Id, string Key, string ProjectKey, DocKind Kind, DiagramFormat? DiagramFormat, string? Title, bool Deleted, string? Url);

/// <summary>
/// A diagram embedded with <c>![caption](KEY)</c> that the reader can read: <see cref="Content"/> is the Mermaid source
/// (null for Canvas, which embeds the picture at <see cref="SnapshotUrl"/>).
/// </summary>
public sealed record DocEmbedDto(Guid Id, string Key, string ProjectKey, string Title, DiagramFormat DiagramFormat, int Version, string? Content, string Url)
{
    /// <summary>Canvas only: the SVG picture of the latest version; null while it has none ("Preview not rendered yet").</summary>
    public string? SnapshotUrl { get; init; }
}

/// <summary>Docs that mention a ticket or link to a doc, newest first; <see cref="Total"/> counts all of them, beyond the page.</summary>
public sealed record DocMentionsDto(int Total, IReadOnlyList<DocSummaryDto> Items)
{
    public static readonly DocMentionsDto Empty = new(0, []);
}

/// <summary>One node of the flat, depth-first tree (root children have depth 1), in the manual order of each folder.</summary>
/// <param name="CommentCount">The comments that are not deleted (always 0 for folders).</param>
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
    bool CanDelete,
    int CommentCount);

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

/// <summary>One immutable published version of a page or diagram.</summary>
/// <param name="RestoredFrom">The version this one restored, if it was created by a version restore.</param>
public sealed record DocVersionDto(
    string DocKey,
    int Number,
    string Title,
    string? Content,
    string? ChangeNote,
    UserRefDto Author,
    WriteChannel Channel,
    DateTimeOffset CreatedAt,
    int? RestoredFrom)
{
    /// <summary>Canvas only: where the SVG picture of this version is served; null while it has none.</summary>
    public string? SnapshotUrl { get; init; }

    /// <summary>What this version's content mentions, filtered by what the reader can read (like <see cref="DocDto.References"/>).</summary>
    public DocReferencesDto References { get; init; } = DocReferencesDto.Empty;

    /// <summary>The diagrams this version's content embeds that the reader can read.</summary>
    public IReadOnlyList<DocEmbedDto> Embeds { get; init; } = [];
}

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

/// <summary>A published version without its content.</summary>
public sealed record DocVersionInfoDto(
    int Number,
    string Title,
    string? ChangeNote,
    UserRefDto Author,
    WriteChannel Channel,
    DateTimeOffset CreatedAt,
    int? RestoredFrom);

public enum DocHistoryItemType
{
    Version = 1,
    Activity = 2,
}

/// <summary>
/// One entry of a doc's history: a published version (number, title, change note, restored from, lines added and removed
/// compared with the version before it, null for Canvas diagrams) or an activity entry that no
/// version represents (rename, move, delete, restore, attachments, comments) with its action and JSON values.
/// </summary>
public sealed record DocHistoryItemDto(
    Guid Id,
    DocHistoryItemType Type,
    DateTimeOffset At,
    UserRefDto? Actor,
    WriteChannel? Channel,
    int? Version,
    string? Title,
    string? ChangeNote,
    int? RestoredFrom,
    int? LinesAdded,
    int? LinesRemoved,
    string? Action,
    string? Field,
    JsonElement? OldValue,
    JsonElement? NewValue);

/// <summary>A page of a doc's history, newest first; <see cref="CurrentVersion"/> is the latest version (0 for folders).</summary>
public sealed record DocHistoryPage(string DocKey, int CurrentVersion, IReadOnlyList<DocHistoryItemDto> Items, string? NextCursor);