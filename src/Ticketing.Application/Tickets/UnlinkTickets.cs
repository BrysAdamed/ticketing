using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <summary>
/// Removes a link of a ticket the caller can write to, addressed by link id (REST) or by target and type (MCP). The other
/// side must be readable, so links to hidden tickets cannot be probed.
/// </summary>
public static class UnlinkTickets
{
    public sealed record Command(string TicketKeyOrId, Guid? LinkId = null, string? TargetKey = null, TicketLinkType? Type = null) : IValidatable
    {
        public void Validate(Validator validator) => validator.Must(
            LinkId is not null || (TargetKey is not null && Type is not null), "targetKey", "Send a link id, or targetKey and type.");
    }

    public sealed record Result(Guid LinkId, bool Removed);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, IClock clock, IActivityLog activity) : IHandler<Command, Result>
    {
        public async Task<Result> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var ticket = await TicketLookup.WriteAsync(db, access, command.TicketKeyOrId, cancellationToken);
            var link = command.LinkId is { } linkId
                ? await db.TicketLinks.SingleOrDefaultAsync(
                    l => l.Id == linkId && (l.SourceTicketId == ticket.Id || l.TargetTicketId == ticket.Id), cancellationToken)
                : await ByTargetAsync(ticket, command.TargetKey!, command.Type!.Value, cancellationToken);
            if (link is null)
                throw NotFound();

            var otherId = link.SourceTicketId == ticket.Id ? link.TargetTicketId : link.SourceTicketId;
            TicketTarget other;
            try
            {
                other = await TicketLookup.ReadAsync(db, access, otherId.ToString(), cancellationToken);
            }
            catch (AppException ex) when (ex.Kind == ErrorKind.NotFound)
            {
                throw NotFound();
            }

            db.TicketLinks.Remove(link);
            var direction = link.Type == TicketLinkType.RelatesTo || link.SourceTicketId == ticket.Id ? LinkDirection.Outward : LinkDirection.Inward;
            activity.Record(
                ActivityEntityType.Ticket, ticket.Id, ticket.ProjectId, "ticket.link.removed", new { type = link.Type, direction, ticketId = other.Id, key = other.Key });
            var now = clock.Now;
            await db.InTransactionAsync(async ct =>
            {
                await db.SaveChangesAsync(ct);
                await db.TouchTicketAsync(ticket.Id, now, ct);
                return true;
            }, cancellationToken);
            return new Result(link.Id, true);
        }

        private async Task<TicketLink?> ByTargetAsync(TicketTarget source, string targetKey, TicketLinkType type, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.ReadAsync(db, access, targetKey, cancellationToken);
            var (from, to) = TicketLink.Canonical(source.Id, target.Id, type);
            return await db.TicketLinks.SingleOrDefaultAsync(l => l.SourceTicketId == from && l.TargetTicketId == to && l.Type == type, cancellationToken);
        }

        private static AppException NotFound() => AppException.NotFound(TicketErrors.LinkNotFound, "The link was not found.");
    }
}
