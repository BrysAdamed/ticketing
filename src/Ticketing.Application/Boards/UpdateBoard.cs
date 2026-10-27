using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Boards;

namespace Ticketing.Application.Boards;

/// <summary>
/// PATCH a board (owner or Admin, spec 5.4): rename, describe, link and unlink projects, transfer ownership. Linking needs
/// write access to the project. Unlinking sends that project's tickets on the board to its backlog top, in their board
/// order, whoever can write there (D-44). Links are added before removals, so the last project can be swapped in one call.
/// </summary>
public static class UpdateBoard
{
    public sealed record Command : IValidatable
    {
        [JsonIgnore]
        public string BoardId { get; init; } = string.Empty;

        public Optional<string> Name { get; init; }

        public Optional<string?> Description { get; init; }

        public IReadOnlyList<string>? AddProjectKeys { get; init; }

        public IReadOnlyList<string>? RemoveProjectKeys { get; init; }

        /// <summary>The new owner: email or user id.</summary>
        public Optional<string> Owner { get; init; }

        [JsonIgnore]
        public uint? ExpectedVersion { get; init; }

        public void Validate(Validator validator)
        {
            if (Name.HasValue)
                validator.Required("name", Name.Value, Board.NameMaxLength);
            if (Description.HasValue)
                validator.MaxLength("description", Description.Value, Board.DescriptionMaxLength);
            if (Owner.HasValue)
                validator.Must(!string.IsNullOrWhiteSpace(Owner.Value), "owner", "owner cannot be empty.");
            validator.Must(AddProjectKeys is not { Count: > Board.MaxProjects }, "addProjectKeys", $"Link at most {Board.MaxProjects} projects.");
        }
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        ITicketRanker ranker) : IHandler<Command, BoardDto>
    {
        private const string FieldChanged = "board.field.changed";

        public async Task<BoardDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var boardId = BoardAccess.ParseId(command.BoardId);
            await db.InTransactionAsync(ct => ApplyAsync(command, boardId, ct), cancellationToken);
            return await GetBoard.Handler.LoadAsync(db, access, currentUser, boardId, cancellationToken);
        }

        private async Task<bool> ApplyAsync(Command command, Guid boardId, CancellationToken cancellationToken)
        {
            await BoardAccess.LockAsync(db, [boardId], exclusive: true, cancellationToken);
            var board = await BoardAccess.ManageAsync(db, currentUser, boardId, cancellationToken);
            db.ExpectVersion(board, command.ExpectedVersion);
            board.EnsureActive();
            var now = clock.Now;

            if (command.Name.HasValue)
            {
                var old = board.Name;
                board.Rename(command.Name.Value);
                activity.RecordChange(ActivityEntityType.Board, board.Id, null, FieldChanged, "name", old, board.Name);
            }
            if (command.Description.HasValue)
            {
                var old = board.Description;
                board.ChangeDescription(command.Description.Value);
                activity.RecordChange(ActivityEntityType.Board, board.Id, null, FieldChanged, "description", old, board.Description);
            }
            if (command.Owner.HasValue)
                await TransferAsync(board, command.Owner.Value, cancellationToken);

            foreach (var reference in command.AddProjectKeys ?? [])
            {
                var grant = await access.EnsureCanWriteAsync(reference, cancellationToken);
                if (board.Links(grant.ProjectId))
                    continue;
                board.LinkProject(grant.ProjectId, currentUser.Id, now);
                activity.Record(ActivityEntityType.Board, board.Id, null, "board.project.linked", new { projectKey = grant.ProjectKey });
            }

            foreach (var reference in command.RemoveProjectKeys ?? [])
            {
                var grant = await access.EnsureCanReadAsync(reference, cancellationToken);
                if (!board.Links(grant.ProjectId))
                    continue;
                board.UnlinkProject(grant.ProjectId);
                var tickets = await BoardRelocation.TicketsAsync(db, board.Id, grant.ProjectId, cancellationToken);
                await BoardRelocation.ApplyAsync(db, ranker, activity, BoardCarryOver.Evacuate(tickets), null, now, cancellationToken);
                activity.Record(ActivityEntityType.Board, board.Id, null, "board.project.unlinked", new { projectKey = grant.ProjectKey, movedToBacklog = tickets.Count });
            }

            await db.SaveChangesAsync(cancellationToken);
            return true;
        }

        private async Task TransferAsync(Board board, string reference, CancellationToken cancellationToken)
        {
            var value = reference.Trim();
            var email = value.ToLowerInvariant();
            var byId = Guid.TryParse(value, out var id);
            var user = await db.Users.AsNoTracking()
                .Where(u => byId ? u.Id == id : u.Email == email)
                .Select(u => new { u.Id, u.IsActive })
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw new AppException(
                    ErrorKind.Validation, BoardErrors.OwnerInvalid, $"User '{value}' was not found.",
                    errors: new Dictionary<string, string[]> { ["owner"] = [$"User '{value}' was not found."] });
            var old = board.OwnerId;
            board.TransferOwnership(user.Id, user.IsActive);
            activity.RecordChange(ActivityEntityType.Board, board.Id, null, FieldChanged, "ownerId", old, board.OwnerId);
        }
    }
}
