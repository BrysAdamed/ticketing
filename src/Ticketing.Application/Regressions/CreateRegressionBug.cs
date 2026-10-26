using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Regressions;

/// <summary>
/// Edits applied to the pre-filled bug (<see cref="GetRegressionBugDraft"/>). Omitted fields keep the draft value; for
/// severity and version an explicit null clears the field.
/// </summary>
public sealed record BugOverrides : IValidatable
{
    public string? Title { get; init; }

    public string? Description { get; init; }

    public Optional<Severity?> Severity { get; init; }

    public Priority? Priority { get; init; }

    public Optional<string?> Version { get; init; }

    public IReadOnlyList<string>? Labels { get; init; }

    /// <summary>Email, id or <c>me</c>; the bug is unassigned by default.</summary>
    public string? Assignee { get; init; }

    public void Validate(Validator validator)
    {
        validator
            .MaxLength("title", Title, Ticket.TitleMaxLength)
            .MaxLength("description", Description, Ticket.DescriptionMaxLength);
        if (Version.HasValue)
            validator.MaxLength("version", Version.Value, Ticket.VersionMaxLength);
    }
}

/// <summary>
/// Creates the bug for a failed item, once (spec 6.11, D-24): a Bug at the top of the session project's backlog built from
/// the draft plus overrides, stored on the item, with a RelatesTo link to the test case's ticket when it has one. Ticket
/// creation and linking reuse the tickets slice's use cases.
/// </summary>
public static class CreateRegressionBug
{
    public sealed record Command(
        BugOverrides? Bug = null,
        [property: JsonIgnore] string SessionKeyOrId = "",
        [property: JsonIgnore] string Item = "");

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        CreateTicket.Handler createTicket,
        LinkTickets.Handler linkTickets) : IHandler<Command, RegressionItemChangeDto>
    {
        public async Task<RegressionItemChangeDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            (command.Bug ?? new BugOverrides()).EnsureValid();
            var target = await RegressionLookup.WriteAsync(db, access, command.SessionKeyOrId, cancellationToken);
            var itemId = await RegressionLookup.ItemIdAsync(db, target, command.Item, cancellationToken);
            var bugId = await db.InTransactionAsync(
                async ct =>
                {
                    var (session, item) = await RegressionItemWrites.LoadForUpdateAsync(db, target, itemId, ct);
                    return await CreateAsync(target, session, item, command.Bug, ct);
                },
                cancellationToken);
            return await RegressionQueries.ItemChangeAsync(db, target, itemId, cancellationToken, bugId);
        }

        /// <summary>Creates and saves the bug for a tracked, failed item inside the caller's transaction (also used by result recording).</summary>
        public async Task<Guid> CreateAsync(
            RegressionTarget target, RegressionSession session, RegressionSessionItem item, BugOverrides? overrides, CancellationToken cancellationToken)
        {
            overrides ??= new BugOverrides();
            var draft = await GetRegressionBugDraft.Handler.DraftAsync(db, currentUser, clock, target, session, item, cancellationToken);
            var command = new CreateTicket.Command(
                Title: overrides.Title ?? draft.Title,
                Type: TicketType.Bug,
                Description: overrides.Description ?? draft.Description,
                Priority: overrides.Priority ?? draft.Priority,
                Severity: overrides.Severity.GetValueOrDefault(draft.Severity),
                Version: overrides.Version.GetValueOrDefault(draft.Version),
                Labels: overrides.Labels ?? draft.Labels,
                Assignee: overrides.Assignee,
                ProjectKeyOrId: target.ProjectId.ToString(),
                Placement: BacklogPlacement.Top);
            command.EnsureValid();

            var bug = await createTicket.CreateAsync(target.Grant, command, parentId: null, cancellationToken);
            item.AttachBug(bug.Id);
            var bugKey = HumanKeys.Ticket(target.Grant.ProjectKey, bug.Number);
            if (draft.RelatedTicket is { } related)
                await linkTickets.HandleAsync(new LinkTickets.Command(related.Key, TicketLinkType.RelatesTo, bug.Id.ToString()), cancellationToken);
            activity.Record(ActivityEntityType.RegressionSession, target.Id, target.ProjectId, "regression.item.bugCreated",
                new { testCaseKey = item.TestCaseKey, bugKey, bugId = bug.Id });
            await db.SaveChangesAsync(cancellationToken);
            return bug.Id;
        }
    }
}
