using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

public enum BacklogPlacement
{
    Bottom = 1,
    Top = 2,
}

/// <summary>
/// Creates one ticket (spec 6.2): number and rank are allocated in the insert transaction, new backlog tickets go to the
/// bottom (or the top for <see cref="BacklogPlacement.Top"/>, used for bugs from regressions). Other features that create
/// tickets inject <see cref="Handler"/> and call <see cref="Handler.HandleAsync"/> or, inside their own transaction,
/// <see cref="Handler.CreateAsync"/>.
/// </summary>
public static class CreateTicket
{
    public sealed record Command(
        string Title,
        TicketType? Type,
        string? Description = null,
        TicketStatus? Status = null,
        Priority? Priority = null,
        Severity? Severity = null,
        int? StoryPoints = null,
        string? Version = null,
        IReadOnlyList<string>? Labels = null,
        string? ParentKey = null,
        string? Assignee = null,
        Guid? BoardId = null,
        [property: JsonIgnore] string ProjectKeyOrId = "",
        [property: JsonIgnore] string? IdempotencyKey = null,
        [property: JsonIgnore] BacklogPlacement Placement = BacklogPlacement.Bottom) : IValidatable
    {
        public void Validate(Validator validator) => Validate(validator, string.Empty);

        public void Validate(Validator validator, string prefix)
        {
            validator
                .Required(prefix + "title", Title, Ticket.TitleMaxLength)
                .Must(Title is null || !Title.Contains('\n', StringComparison.Ordinal), prefix + "title", "title must be a single line.")
                .Must(Type is not null, prefix + "type", "type is required (Epic, UserStory, Technical, Spike or Bug).")
                .MaxLength(prefix + "description", Description, Ticket.DescriptionMaxLength)
                .MaxLength(prefix + "version", Version, Ticket.VersionMaxLength)
                .Range(prefix + "storyPoints", StoryPoints, 0, Ticket.MaxStoryPoints);
            if (Labels is { Count: > TicketLabels.MaxCount })
                validator.Add(prefix + "labels", $"A ticket can have at most {TicketLabels.MaxCount} labels.");
        }
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        IProjectCounters counters,
        ITicketRanker ranker,
        IIdempotency idempotency) : IHandler<Command, TicketSummaryDto>
    {
        public async Task<TicketSummaryDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var grant = await access.EnsureCanWriteAsync(command.ProjectKeyOrId, cancellationToken);
            return await idempotency.ExecuteAsync(
                command.IdempotencyKey, "tickets.create", command with { IdempotencyKey = null, ProjectKeyOrId = grant.ProjectId.ToString() },
                ct => db.InTransactionAsync(
                    async inner =>
                    {
                        var parentId = command.ParentKey is null ? (Guid?)null : await ParentAsync(command.ParentKey, inner);
                        var ticket = await CreateAsync(grant, command, parentId, inner);
                        return (await TicketQueries.SummariesAsync(db, [ticket.Id], inner))[0];
                    },
                    ct),
                cancellationToken);
        }

        /// <summary>Resolves a parent reference: any readable, non-deleted ticket (the hierarchy rules then require the same project).</summary>
        public async Task<Guid> ParentAsync(string parentKey, CancellationToken cancellationToken) =>
            (await TicketLookup.ReadAsync(db, access, parentKey, cancellationToken)).Id;

        /// <summary>
        /// Creates and saves the ticket inside the caller's transaction (it joins one or opens one). The command must be
        /// validated and the caller must hold write access to <paramref name="grant"/>'s project.
        /// </summary>
        public Task<Ticket> CreateAsync(ProjectAccessGrant grant, Command command, Guid? parentId, CancellationToken cancellationToken) =>
            db.InTransactionAsync(
                async ct =>
                {
                    var now = clock.Now;
                    var container = await ContainerAsync(grant, command.BoardId, ct);
                    var rank = command.Placement == BacklogPlacement.Top && command.BoardId is null
                        ? await ranker.TopAsync(container, null, ct)
                        : await ranker.BottomAsync(container, null, ct);
                    var number = await counters.NextAsync(grant.ProjectId, CounterKind.Ticket, ct);

                    var ticket = Ticket.Create(grant.ProjectId, number, command.Title, command.Type!.Value, currentUser.Id, rank, now);
                    if (command.BoardId is { } boardId)
                        ticket.PlaceOnBoard(boardId, rank);
                    ticket.ChangeDescription(command.Description);
                    ticket.ChangePriority(command.Priority ?? Priority.Medium);
                    ticket.ChangeSeverity(command.Severity);
                    ticket.ChangeStoryPoints(command.StoryPoints);
                    ticket.ChangeVersion(command.Version);
                    ticket.ReplaceLabels(command.Labels);
                    if (command.Status is { } status)
                        ticket.ChangeStatus(status, null, now);
                    if (parentId is { } parent)
                        await TicketTree.SetParentAsync(db, ticket, parent, ct);
                    if (command.Assignee is not null)
                        ticket.AssignTo(await TicketUsers.AssigneeAsync(db, currentUser, grant, command.Assignee, ct));

                    db.Tickets.Add(ticket);
                    activity.Record(ActivityEntityType.Ticket, ticket.Id, grant.ProjectId, "ticket.created", new
                    {
                        key = HumanKeys.Ticket(grant.ProjectKey, number),
                        ticket.Title,
                        ticket.Type,
                        ticket.Status,
                        ticket.Priority,
                        location = command.BoardId is null ? "backlog" : "board",
                    });
                    await db.SaveChangesAsync(ct);
                    return ticket;
                },
                cancellationToken);

        private async Task<RankContainer> ContainerAsync(ProjectAccessGrant grant, Guid? boardId, CancellationToken cancellationToken)
        {
            if (boardId is not { } id)
                return RankContainer.Backlog(grant.ProjectId);

            var board = await db.Boards.AsNoTracking()
                .Where(b => b.Id == id && b.DeletedAt == null)
                .Select(b => new { b.ArchivedAt, Links = b.Projects.Any(p => p.ProjectId == grant.ProjectId) })
                .SingleOrDefaultAsync(cancellationToken);
            if (board is null || !board.Links)
                throw new AppException(
                    ErrorKind.Validation, TicketErrors.BoardInvalid, $"The board does not exist or does not link project {grant.ProjectKey}.",
                    "Pick a board that links this project, or leave the board empty to create the ticket in the backlog.",
                    new Dictionary<string, string[]> { ["boardId"] = ["The board does not link this project."] });
            if (board.ArchivedAt is not null)
                throw AppException.Conflict(TicketErrors.BoardInvalid, "The board is archived and read-only.");
            return RankContainer.Board(id);
        }
    }
}
