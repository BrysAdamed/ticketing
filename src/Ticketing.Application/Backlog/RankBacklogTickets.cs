using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Backlog;

public enum RankPosition
{
    Top = 1,
    Bottom = 2,
}

/// <summary>
/// Reorders backlog tickets (spec 6.6): one or more tickets (multi-select) move as a block, in the given order, right
/// before or after another backlog ticket, or to the top or bottom. Rank is invisible, so no history is written.
/// </summary>
public static class RankBacklogTickets
{
    public const int MaxTickets = 100;

    public sealed record Command(
        IReadOnlyList<string> Tickets,
        string? BeforeKey = null,
        string? AfterKey = null,
        RankPosition? Position = null,
        [property: JsonIgnore] string ProjectKeyOrId = "") : IValidatable
    {
        public void Validate(Validator validator)
        {
            validator.Must(Tickets is { Count: > 0 and <= MaxTickets }, "tickets", $"Send 1..{MaxTickets} tickets.");
            var anchors = (BeforeKey is null ? 0 : 1) + (AfterKey is null ? 0 : 1) + (Position is null ? 0 : 1);
            validator.Must(anchors == 1, "position", "Send exactly one of beforeKey, afterKey or position (Top or Bottom).");
        }
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ITicketRanker ranker) : IHandler<Command, int>
    {
        public async Task<int> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var grant = await access.EnsureCanWriteAsync(command.ProjectKeyOrId, cancellationToken);
            var ids = await ResolveAsync(grant, command.Tickets, cancellationToken);
            if (ids.Distinct().Count() != ids.Count)
                throw AppException.Invalid("tickets", "Each ticket may appear only once.");

            var anchorKey = command.BeforeKey ?? command.AfterKey;
            RankAnchor anchor = command.Position == RankPosition.Top ? RankAnchor.Top : RankAnchor.Bottom;
            if (anchorKey is not null)
            {
                var anchorId = (await ResolveAsync(grant, [anchorKey], cancellationToken))[0];
                if (ids.Contains(anchorId))
                    throw AppException.Invalid("position", "A ticket cannot be placed next to itself.");
                anchor = command.BeforeKey is not null ? RankAnchor.Before(anchorId) : RankAnchor.After(anchorId);
            }

            return await db.InTransactionAsync(
                async ct =>
                {
                    var tickets = await db.Tickets.Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id, ct);
                    var ranks = await ranker.PlaceManyAsync(RankContainer.Backlog(grant.ProjectId), anchor, ids.Count, ids, ct);
                    for (var i = 0; i < ids.Count; i++)
                        tickets[ids[i]].Rerank(ranks[i]);
                    await db.SaveChangesAsync(ct);
                    return ids.Count;
                },
                cancellationToken);
        }

        /// <summary>Resolves keys or ids to backlog tickets of the project, keeping the input order.</summary>
        private async Task<List<Guid>> ResolveAsync(ProjectAccessGrant grant, IReadOnlyList<string> references, CancellationToken cancellationToken)
        {
            var ids = new HashSet<Guid>();
            var numbers = new HashSet<int>();
            foreach (var reference in references)
            {
                if (Guid.TryParse(reference, out var id))
                    ids.Add(id);
                else if (HumanKeys.TryParseTicket(reference, out var projectKey, out var number) && projectKey == grant.ProjectKey)
                    numbers.Add(number);
                else
                    throw TicketLookup.NotFound(reference);
            }

            var projectId = grant.ProjectId;
            var rows = await db.Tickets.AsNoTracking()
                .Where(t => t.ProjectId == projectId && (ids.Contains(t.Id) || numbers.Contains(t.Number)))
                .Select(t => new { t.Id, t.Number, t.DeletedAt, t.BoardId })
                .ToListAsync(cancellationToken);

            var result = new List<Guid>(references.Count);
            foreach (var reference in references)
            {
                var row = Guid.TryParse(reference, out var id)
                    ? rows.SingleOrDefault(r => r.Id == id)
                    : rows.SingleOrDefault(r => HumanKeys.TryParseTicket(reference, out _, out var n) && r.Number == n);
                if (row is null || row.DeletedAt is not null)
                    throw TicketLookup.NotFound(reference);
                if (row.BoardId is not null)
                    throw AppException.Conflict(
                        TicketErrors.NotInBacklog, $"{HumanKeys.Ticket(grant.ProjectKey, row.Number)} is on a board, not in the backlog.",
                        "Reload the backlog; the ticket was moved.");
                result.Add(row.Id);
            }
            return result;
        }
    }
}
