using Ticketing.Application.Abstractions;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Boards;

namespace Ticketing.Application.Boards;

/// <summary>
/// Soft-deletes a board (owner or Admin, archived or not). All its tickets, Done included, go to the top of their project
/// backlogs in board order (spec 6.4), whoever can write there (D-44).
/// </summary>
public static class DeleteBoard
{
    public sealed record Command(string BoardId);

    public sealed class Handler(
        ITicketingDbContext db,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        ITicketRanker ranker) : IHandler<Command, bool>
    {
        public Task<bool> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var boardId = BoardAccess.ParseId(command.BoardId);
            return db.InTransactionAsync(
                async ct =>
                {
                    await BoardAccess.LockAsync(db, [boardId], exclusive: true, ct);
                    var board = await BoardAccess.ManageAsync(db, currentUser, boardId, ct);
                    var now = clock.Now;
                    var tickets = await BoardRelocation.TicketsAsync(db, boardId, null, ct);
                    await BoardRelocation.ApplyAsync(db, ranker, activity, BoardCarryOver.Evacuate(tickets), null, now, ct);
                    board.Delete(currentUser.Id, now);
                    activity.Record(ActivityEntityType.Board, board.Id, null, "board.deleted", new { board.Name, movedToBacklog = tickets.Count });
                    await db.SaveChangesAsync(ct);
                    return true;
                },
                cancellationToken);
        }
    }
}
