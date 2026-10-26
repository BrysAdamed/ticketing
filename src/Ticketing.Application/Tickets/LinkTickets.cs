using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <summary>
/// Links two tickets (spec 4.6, I-05): write access to the source's project, read access to the target's (any project).
/// RelatesTo is an unordered pair, so the reverse duplicate is rejected too. History is written on the source ticket.
/// </summary>
public static class LinkTickets
{
    public sealed record Command(string TargetKey, TicketLinkType? Type, [property: JsonIgnore] string SourceKeyOrId = "") : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Required("targetKey", TargetKey, 64)
            .Must(Type is not null, "type", "type is required (Blocks, RelatesTo or Duplicates).");
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, IClock clock, IActivityLog activity, ICurrentUser currentUser)
        : IHandler<Command, TicketLinkDto>
    {
        public async Task<TicketLinkDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var source = await TicketLookup.WriteAsync(db, access, command.SourceKeyOrId, cancellationToken);
            var target = await TicketLookup.ReadAsync(db, access, command.TargetKey, cancellationToken);
            var type = command.Type!.Value;

            var link = TicketLink.Create(source.Id, target.Id, type, currentUser.Id, clock.Now);
            if (await db.TicketLinks.AnyAsync(
                    l => l.SourceTicketId == link.SourceTicketId && l.TargetTicketId == link.TargetTicketId && l.Type == type, cancellationToken))
                throw Exists(source, target, type);

            db.TicketLinks.Add(link);
            (await db.Tickets.SingleAsync(t => t.Id == source.Id, cancellationToken)).Touch(clock.Now);
            var direction = type == TicketLinkType.RelatesTo || link.SourceTicketId == source.Id ? LinkDirection.Outward : LinkDirection.Inward;
            activity.Record(ActivityEntityType.Ticket, source.Id, source.ProjectId, "ticket.link.added", new { type, direction, ticketId = target.Id, key = target.Key });
            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (ex.IsUniqueViolation())
            {
                throw Exists(source, target, type);
            }

            var other = (await TicketQueries.SummariesAsync(db, [target.Id], cancellationToken))[0];
            return new TicketLinkDto(
                link.Id, type, direction, TicketQueries.LinkLabel(type, direction),
                new TicketRefDto(other.Id, other.Key, other.Title, other.Type, other.Status, other.Priority, other.Assignee), link.CreatedAt);
        }

        private static AppException Exists(TicketTarget source, TicketTarget target, TicketLinkType type) =>
            AppException.Conflict(TicketErrors.LinkExists, $"{source.Key} and {target.Key} are already linked with {type}.");
    }
}
