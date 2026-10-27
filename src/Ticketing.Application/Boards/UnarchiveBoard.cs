using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;

namespace Ticketing.Application.Boards;

/// <summary>Makes an archived board writable again (owner or Admin). Tickets carried over stay where they went.</summary>
public static class UnarchiveBoard
{
    public sealed record Command(string BoardId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IActivityLog activity) : IHandler<Command, BoardDto>
    {
        public async Task<BoardDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var board = await BoardAccess.ManageAsync(db, currentUser, BoardAccess.ParseId(command.BoardId), cancellationToken);
            if (board.IsArchived)
            {
                board.Unarchive();
                activity.Record(ActivityEntityType.Board, board.Id, null, "board.unarchived");
                await db.SaveChangesAsync(cancellationToken);
            }
            return await GetBoard.Handler.LoadAsync(db, access, currentUser, board.Id, cancellationToken);
        }
    }
}
