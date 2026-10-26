using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Boards;

namespace Ticketing.Application.Boards;

/// <summary>
/// Board permissions (spec 5.4): every signed-in user sees every non-deleted board; only the owner or an Admin manages it.
/// Board ids come from user input as strings (MCP) or route values; anything that is not a live board is 404.
/// </summary>
public static class BoardAccess
{
    public static bool CanManage(ICurrentUser user, Guid ownerId) => user.IsAdmin || user.Id == ownerId;

    public static Guid ParseId(string boardId) =>
        Guid.TryParse(boardId, out var id) ? id : throw NotFound(boardId);

    /// <summary>Loads the tracked board with its project links and requires the caller to manage it with write-scoped credentials.</summary>
    public static async Task<Board> ManageAsync(ITicketingDbContext db, ICurrentUser user, Guid boardId, CancellationToken cancellationToken)
    {
        user.EnsureWriteScope();
        var board = await db.Boards.Include(b => b.Projects).SingleOrDefaultAsync(b => b.Id == boardId && b.DeletedAt == null, cancellationToken)
            ?? throw NotFound(boardId.ToString());
        if (!CanManage(user, board.OwnerId))
            throw AppException.Forbidden(BoardErrors.NotOwner, "Only the board owner or an administrator can do this.", "Ask the board owner to make the change.");
        return board;
    }

    public static AppException NotFound(string boardId) =>
        AppException.NotFound(BoardErrors.NotFound, $"Board '{boardId}' was not found.");

    /// <summary>
    /// Row-locks boards for the rest of the transaction, in id order so concurrent operations cannot deadlock. Moves take a
    /// shared lock on every board they touch; archive and delete take an exclusive one, so no ticket lands on a board
    /// while it is being archived.
    /// </summary>
    public static Task LockAsync(ITicketingDbContext db, IEnumerable<Guid> boardIds, bool exclusive, CancellationToken cancellationToken)
    {
        var ids = boardIds.Distinct().Order().ToArray();
        if (ids.Length == 0)
            return Task.CompletedTask;
        return exclusive
            ? db.Database.ExecuteSqlAsync($"SELECT id FROM boards WHERE id = ANY({ids}) ORDER BY id FOR UPDATE", cancellationToken)
            : db.Database.ExecuteSqlAsync($"SELECT id FROM boards WHERE id = ANY({ids}) ORDER BY id FOR SHARE", cancellationToken);
    }
}
