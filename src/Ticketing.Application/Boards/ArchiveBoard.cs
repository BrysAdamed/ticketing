using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Boards;

namespace Ticketing.Application.Boards;

/// <summary>
/// Archives a board with carry-over (spec 6.4, I-11): Done tickets stay as a record; the others go to the bottom of the
/// target board when it links their project, otherwise to the top of their project backlog, keeping their relative order.
/// Moves ignore per-ticket write access (D-44). The result counts only tickets the caller can read.
/// </summary>
public static class ArchiveBoard
{
    public const string Backlog = "backlog";

    /// <param name="CarryOverTo"><c>backlog</c> or the id of another active board.</param>
    public sealed record Command(string CarryOverTo = Backlog, [property: JsonIgnore] string BoardId = "") : IValidatable
    {
        public void Validate(Validator validator) => validator.Must(
            string.Equals(CarryOverTo?.Trim(), Backlog, StringComparison.OrdinalIgnoreCase) || Guid.TryParse(CarryOverTo, out _),
            "carryOverTo", "carryOverTo must be 'backlog' or a board id.");
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        ITicketRanker ranker) : IHandler<Command, ArchiveBoardResultDto>
    {
        public async Task<ArchiveBoardResultDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var boardId = BoardAccess.ParseId(command.BoardId);
            Guid? targetId = Guid.TryParse(command.CarryOverTo, out var t) ? t : null;
            var plan = await db.InTransactionAsync(ct => ArchiveAsync(boardId, targetId, ct), cancellationToken);

            var involved = plan.Tickets.Select(x => x.ProjectId).Distinct().ToList();
            var readable = (await access.ReadableProjects().Where(p => involved.Contains(p.Id)).Select(p => p.Id).ToListAsync(cancellationToken)).ToHashSet();
            var visible = plan.Tickets.Where(x => readable.Contains(x.ProjectId)).Select(x => x.Id).ToHashSet();
            var board = await GetBoard.Handler.LoadAsync(db, access, currentUser, boardId, cancellationToken);
            return new ArchiveBoardResultDto(
                board,
                targetId,
                plan.Plan.ToBoard.Count(visible.Contains),
                plan.Plan.ToBacklogs.Values.SelectMany(v => v).Count(visible.Contains),
                plan.Plan.Stay.Count(visible.Contains));
        }

        private async Task<ArchiveOutcome> ArchiveAsync(Guid boardId, Guid? targetId, CancellationToken cancellationToken)
        {
            await BoardAccess.LockAsync(db, targetId is { } id ? [boardId, id] : [boardId], exclusive: true, cancellationToken);
            var board = await BoardAccess.ManageAsync(db, currentUser, boardId, cancellationToken);
            Board? target = null;
            if (targetId is { } tid)
            {
                target = await db.Boards.AsNoTracking().Include(b => b.Projects).SingleOrDefaultAsync(b => b.Id == tid && b.DeletedAt == null, cancellationToken)
                    ?? throw new AppException(
                        ErrorKind.Validation, BoardErrors.CarryOverInvalid, $"Board '{tid}' was not found.",
                        errors: new Dictionary<string, string[]> { ["carryOverTo"] = ["The target board was not found."] });
            }

            var now = clock.Now;
            board.Archive(currentUser.Id, now, target);
            var tickets = await BoardRelocation.TicketsAsync(db, boardId, null, cancellationToken);
            var plan = BoardCarryOver.Plan(tickets, target);
            await BoardRelocation.ApplyAsync(db, ranker, activity, plan, target?.Id, now, cancellationToken);
            activity.Record(ActivityEntityType.Board, board.Id, null, "board.archived", new
            {
                carryOverTo = target?.Id.ToString() ?? Backlog,
                movedToBoard = plan.ToBoard.Count,
                movedToBacklog = plan.ToBacklogCount,
                stayedDone = plan.Stay.Count,
            });
            await db.SaveChangesAsync(cancellationToken);
            return new ArchiveOutcome(tickets, plan);
        }
    }

    private sealed record ArchiveOutcome(IReadOnlyList<BoardTicket> Tickets, CarryOverPlan Plan);
}
