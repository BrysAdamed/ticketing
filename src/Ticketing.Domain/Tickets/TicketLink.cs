using Ticketing.Domain.Common;

namespace Ticketing.Domain.Tickets;

public sealed class TicketLink
{
    private TicketLink()
    {
    }

    public Guid Id { get; private set; }

    public Guid SourceTicketId { get; private set; }

    public Guid TargetTicketId { get; private set; }

    public TicketLinkType Type { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public Guid CreatedById { get; private set; }

    /// <summary>Creates a link; RelatesTo is unordered, so the smaller id is always stored as the source (spec 4.6).</summary>
    public static TicketLink Create(Guid sourceTicketId, Guid targetTicketId, TicketLinkType type, Guid createdById, DateTimeOffset now)
    {
        if (sourceTicketId == targetTicketId)
            throw DomainException.Invalid("targetKey", TicketErrors.LinkSelf, "A ticket cannot be linked to itself.");

        var (source, target) = Canonical(sourceTicketId, targetTicketId, type);
        return new TicketLink
        {
            Id = EntityId.New(),
            SourceTicketId = source,
            TargetTicketId = target,
            Type = type,
            CreatedAt = now,
            CreatedById = createdById,
        };
    }

    public static (Guid Source, Guid Target) Canonical(Guid sourceTicketId, Guid targetTicketId, TicketLinkType type) =>
        type == TicketLinkType.RelatesTo && sourceTicketId.CompareTo(targetTicketId) > 0
            ? (targetTicketId, sourceTicketId)
            : (sourceTicketId, targetTicketId);
}
