using System.Text.Json;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

public sealed record UserRefDto(Guid Id, string Email, string DisplayName, bool IsActive);

public enum TicketLocationKind
{
    Backlog = 1,
    Board = 2,
}

public sealed record TicketLocationDto(TicketLocationKind Kind, Guid? BoardId, string? BoardName);

/// <summary>The ticket summary of spec 9.2, used by create results, lists and MCP.</summary>
public sealed record TicketSummaryDto(
    Guid Id,
    string Key,
    string ProjectKey,
    string Title,
    TicketType Type,
    TicketStatus Status,
    Priority Priority,
    Severity? Severity,
    UserRefDto? Assignee,
    int? StoryPoints,
    IReadOnlyList<string> Labels,
    string? Version,
    string? ParentKey,
    TicketLocationDto Location,
    DateTimeOffset UpdatedAt,
    string Url,
    uint RowVersion);

/// <summary>A compact reference to another ticket: parent, child or link target.</summary>
public sealed record TicketRefDto(Guid Id, string Key, string Title, TicketType Type, TicketStatus Status, Priority Priority, UserRefDto? Assignee);

public sealed record ProgressDto(int ToDo, int InProgress, int Done, int Total);

public enum LinkDirection
{
    Outward = 1,
    Inward = 2,
}

/// <param name="Label">How the link reads from this ticket, for example "blocks" or "is blocked by".</param>
public sealed record TicketLinkDto(Guid Id, TicketLinkType Type, LinkDirection Direction, string Label, TicketRefDto Ticket, DateTimeOffset CreatedAt);

public sealed record TestCaseRefDto(Guid Id, string Key, string Title, TestCaseStatus Status, int StepCount);

public sealed record TicketPermissionsDto(bool CanEdit, bool CanDelete, bool CanComment);

public sealed record TicketDto(
    Guid Id,
    string Key,
    Guid ProjectId,
    string ProjectKey,
    string ProjectName,
    int Number,
    string Title,
    string? Description,
    TicketType Type,
    TicketStatus Status,
    Resolution? Resolution,
    Priority Priority,
    Severity? Severity,
    int? StoryPoints,
    string? Version,
    IReadOnlyList<string> Labels,
    TicketRefDto? Parent,
    TicketLocationDto Location,
    UserRefDto? Assignee,
    UserRefDto Reporter,
    UserRefDto CreatedBy,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset StatusChangedAt,
    DateTimeOffset? ResolvedAt,
    ProjectRole MyRole,
    TicketPermissionsDto Permissions,
    string Url,
    uint RowVersion,
    IReadOnlyList<TicketRefDto>? Children,
    ProgressDto? ChildProgress,
    IReadOnlyList<TicketLinkDto>? Links,
    IReadOnlyList<CommentDto>? Comments,
    int? CommentCount,
    IReadOnlyList<TestCaseRefDto>? TestCases);

public sealed record CommentDto(
    Guid Id,
    Guid TicketId,
    UserRefDto Author,
    string Body,
    DateTimeOffset CreatedAt,
    DateTimeOffset? EditedAt,
    bool Deleted,
    DateTimeOffset? DeletedAt,
    bool CanEdit,
    bool CanDelete);

public sealed record ActivityEntryDto(
    Guid Id,
    DateTimeOffset OccurredAt,
    UserRefDto? Actor,
    WriteChannel? Channel,
    string Action,
    string? Field,
    JsonElement? OldValue,
    JsonElement? NewValue);

/// <summary>A page of ticket history plus the users that assignee/reporter values refer to (ids in the values).</summary>
public sealed record TicketHistoryPage(IReadOnlyList<ActivityEntryDto> Items, string? NextCursor, IReadOnlyList<UserRefDto> Users);
