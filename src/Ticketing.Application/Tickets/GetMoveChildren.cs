using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;

namespace Ticketing.Application.Tickets;

/// <param name="Children">The sub-tickets that would come along, in the order they would be placed.</param>
/// <param name="OnOtherBoard">Skipped: on a board other than the place the parent is leaving.</param>
/// <param name="InBacklog">Skipped: in the backlog while the parent is on a board.</param>
/// <param name="Done">Skipped: Done.</param>
public sealed record MoveChildrenParentDto(string Key, IReadOnlyList<TicketSummaryDto> Children, int OnOtherBoard, int InBacklog, int Done);

/// <param name="Count">Sub-tickets that would come along over all parents.</param>
public sealed record MoveChildrenPreviewDto(IReadOnlyList<MoveChildrenParentDto> Parents, int Count, int OnOtherBoard, int InBacklog, int Done);

/// <summary>
/// Read-only preview of <see cref="MoveTickets"/> with <c>includeChildren</c> (D-107): per parent, the sub-tickets that would
/// come along and how many stay behind and why, so the move prompt shows real numbers. Serves REST
/// <c>GET /tickets/move/children</c> and MCP <c>get_move_children</c>.
/// </summary>
public static class GetMoveChildren
{
    /// <param name="Keys">The tickets about to move, keys or ids.</param>
    /// <param name="From"><c>backlog</c> or a board id the tickets are expected to be in; a mismatch is a conflict.</param>
    public sealed record Query(IReadOnlyList<string> Keys, string? From = null) : IValidatable
    {
        public void Validate(Validator validator) =>
            validator
                .Must(Keys is { Count: > 0 and <= MoveTickets.MaxTickets }, "keys", $"Send 1..{MoveTickets.MaxTickets} ticket keys.")
                .Must(From is null || MoveTickets.IsContainer(From), "from", "from must be 'backlog' or a board id.");
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, MoveChildrenPreviewDto>
    {
        public async Task<MoveChildrenPreviewDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            request.EnsureValid();
            var targets = new List<TicketTarget>(request.Keys.Count);
            foreach (var key in request.Keys)
            {
                var target = await TicketLookup.ReadAsync(db, access, key, cancellationToken);
                if (targets.All(t => t.Id != target.Id))
                    targets.Add(target);
            }

            var ids = targets.Select(t => t.Id).ToList();
            var boards = await db.Tickets.AsNoTracking().Where(t => ids.Contains(t.Id))
                .Select(t => new { t.Id, t.BoardId }).ToDictionaryAsync(t => t.Id, t => t.BoardId, cancellationToken);
            MoveTickets.EnsureSource(request.From, targets, id => boards[id]);

            var groups = await MoveChildren.GroupsAsync(db, [.. targets.Select(t => new MoveChildren.Parent(t.Id, boards[t.Id]))], cancellationToken);
            var summaries = (await TicketQueries.SummariesAsync(db, [.. groups.SelectMany(g => g.Children).Select(c => c.Id)], cancellationToken))
                .ToDictionary(s => s.Id);
            var parents = targets.Zip(groups, (target, group) => new MoveChildrenParentDto(
                target.Key, [.. group.Children.Select(c => summaries[c.Id])], group.OnOtherBoard, group.InBacklog, group.Done)).ToList();
            return new MoveChildrenPreviewDto(
                parents, parents.Sum(p => p.Children.Count), parents.Sum(p => p.OnOtherBoard), parents.Sum(p => p.InBacklog), parents.Sum(p => p.Done));
        }
    }
}
