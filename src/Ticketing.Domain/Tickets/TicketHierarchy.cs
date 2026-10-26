using Ticketing.Domain.Common;

namespace Ticketing.Domain.Tickets;

/// <summary>Parent and child rules (spec 6.3): same project, Epics have no parent, at most 3 levels, no cycles.</summary>
public static class TicketHierarchy
{
    public const int MaxDepth = 3;

    /// <param name="child">The ticket that gets a new parent.</param>
    /// <param name="parent">The proposed parent.</param>
    /// <param name="parentAncestorIds">The proposed parent's ancestors, nearest first (empty when the parent is a root).</param>
    /// <param name="childSubtreeHeight">Levels in the child's subtree including the child itself (1 for a leaf).</param>
    public static void EnsureCanSetParent(Ticket child, Ticket parent, IReadOnlyCollection<Guid> parentAncestorIds, int childSubtreeHeight)
    {
        if (parent.Id == child.Id || parentAncestorIds.Contains(child.Id))
            throw new DomainException(
                TicketErrors.ParentCycle, "Setting this parent would create a cycle.", DomainErrorKind.Conflict, "parentKey",
                "Pick a parent that is not the ticket itself or one of its descendants.");
        if (parent.ProjectId != child.ProjectId)
            throw new DomainException(
                TicketErrors.ParentOtherProject, "Parent and child must be in the same project.", DomainErrorKind.Conflict, "parentKey",
                "Use a link to relate tickets across projects.");
        if (child.Type == TicketType.Epic)
            throw new DomainException(TicketErrors.EpicCannotHaveParent, "An Epic cannot have a parent.", DomainErrorKind.Conflict, "parentKey");

        var depth = parentAncestorIds.Count + 1 + childSubtreeHeight;
        if (depth > MaxDepth)
            throw new DomainException(
                TicketErrors.ParentDepth, $"The ticket hierarchy would be {depth} levels deep; the maximum is {MaxDepth}.",
                DomainErrorKind.Conflict, "parentKey", "Pick a parent whose own parent is an Epic or empty.");
    }

    public static void EnsureCanChangeType(Ticket ticket, TicketType newType)
    {
        if (newType == TicketType.Epic && ticket.ParentId is not null)
            throw new DomainException(
                TicketErrors.EpicCannotHaveParent, "A ticket with a parent cannot become an Epic.", DomainErrorKind.Conflict, "type",
                "Clear the parent first.");
    }
}
