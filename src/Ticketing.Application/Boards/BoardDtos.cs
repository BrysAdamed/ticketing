using Ticketing.Application.Tickets;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Boards;

public sealed record StatusCategoryCountsDto(int ToDo, int InProgress, int Done);

public sealed record BoardProjectRefDto(Guid Id, string Key, string Name);

/// <param name="Projects">Linked projects the caller can read; private projects they cannot read are left out (spec 5.4).</param>
/// <param name="Counts">Cards the caller can see, by status category.</param>
public sealed record BoardSummaryDto(
    Guid Id,
    string Name,
    string? Description,
    UserRefDto Owner,
    IReadOnlyList<BoardProjectRefDto> Projects,
    StatusCategoryCountsDto Counts,
    bool CanManage,
    DateTimeOffset? ArchivedAt,
    DateTimeOffset CreatedAt);

/// <param name="CanWrite">Whether the caller may place, move and rank this project's tickets.</param>
/// <param name="CardCount">The project's tickets on this board, for the unlink confirmation.</param>
public sealed record BoardProjectDto(Guid Id, string Key, string Name, bool CanWrite, bool IsArchived, int CardCount);

/// <summary>A lean card: users and parents are listed once in <see cref="BoardDto.Users"/> and <see cref="BoardDto.Parents"/>.</summary>
public sealed record BoardCardDto(
    Guid Id,
    string Key,
    string ProjectKey,
    string Title,
    TicketType Type,
    Priority Priority,
    Severity? Severity,
    int? StoryPoints,
    IReadOnlyList<string> Labels,
    Guid? AssigneeId,
    Guid? ParentId,
    int ChildCount,
    int ChildDoneCount);

public sealed record BoardColumnDto(TicketStatus Status, StatusCategory Category, IReadOnlyList<BoardCardDto> Cards);

/// <param name="ParentId">The parent's own parent, so clients can find a card's epic two levels up.</param>
public sealed record BoardParentDto(Guid Id, string Key, string Title, TicketType Type, Guid? ParentId);

public sealed record BoardPermissionsDto(bool CanManage);

/// <summary>A board with one column per status in enum order, cards in rank order, only cards the caller can read (spec 6.4, 6.5).</summary>
public sealed record BoardDto(
    Guid Id,
    string Name,
    string? Description,
    UserRefDto Owner,
    DateTimeOffset? ArchivedAt,
    DateTimeOffset CreatedAt,
    BoardPermissionsDto Permissions,
    IReadOnlyList<BoardProjectDto> Projects,
    IReadOnlyList<BoardColumnDto> Columns,
    IReadOnlyList<UserRefDto> Users,
    IReadOnlyList<BoardParentDto> Parents,
    uint RowVersion);

/// <summary>Where the archived board's tickets went; counts only tickets the caller can read.</summary>
public sealed record ArchiveBoardResultDto(BoardDto Board, Guid? CarriedOverToBoardId, int MovedToBoard, int MovedToBacklog, int StayedDone);

/// <summary>The board as MCP tools return it: cards inline with assignee and parent key (spec 9.3 <c>get_board</c>).</summary>
public sealed record BoardToolDto(
    Guid Id,
    string Name,
    string? Description,
    UserRefDto Owner,
    DateTimeOffset? ArchivedAt,
    IReadOnlyList<BoardProjectDto> Projects,
    IReadOnlyList<BoardToolColumnDto> Columns,
    uint RowVersion)
{
    public static BoardToolDto From(BoardDto board)
    {
        var users = board.Users.ToDictionary(u => u.Id);
        var parents = board.Parents.ToDictionary(p => p.Id);
        return new BoardToolDto(
            board.Id, board.Name, board.Description, board.Owner, board.ArchivedAt, board.Projects,
            [.. board.Columns.Select(c => new BoardToolColumnDto(c.Status, c.Cards.Count, [.. c.Cards.Select(card => new BoardToolCardDto(
                card.Key, card.Title, card.Type, c.Status, card.Priority, card.Severity, card.StoryPoints, card.Labels,
                card.AssigneeId is { } a ? users.GetValueOrDefault(a) : null,
                card.ParentId is { } p ? parents.GetValueOrDefault(p)?.Key : null,
                TicketQueries.Url(card.Key)))]))],
            board.RowVersion);
    }
}

public sealed record ArchiveBoardToolResultDto(BoardToolDto Board, Guid? CarriedOverToBoardId, int MovedToBoard, int MovedToBacklog, int StayedDone);

public sealed record BoardToolColumnDto(TicketStatus Status, int Count, IReadOnlyList<BoardToolCardDto> Tickets);

public sealed record BoardToolCardDto(
    string Key,
    string Title,
    TicketType Type,
    TicketStatus Status,
    Priority Priority,
    Severity? Severity,
    int? StoryPoints,
    IReadOnlyList<string> Labels,
    UserRefDto? Assignee,
    string? ParentKey,
    string Url);
