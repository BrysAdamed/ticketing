using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Boards;

namespace Ticketing.Application.Boards;

/// <summary>Creates a board linking 1..20 projects the caller can write to; the caller becomes its owner (spec 5.2, 5.4).</summary>
public static class CreateBoard
{
    public sealed record Command(
        string Name,
        string? Description = null,
        IReadOnlyList<string>? ProjectKeys = null,
        [property: JsonIgnore] string? IdempotencyKey = null) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Required("name", Name, Board.NameMaxLength)
            .MaxLength("description", Description, Board.DescriptionMaxLength)
            .Must(ProjectKeys is { Count: > 0 and <= Board.MaxProjects }, "projectKeys", $"Link 1..{Board.MaxProjects} projects.");
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        IIdempotency idempotency) : IHandler<Command, BoardDto>
    {
        public Task<BoardDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            currentUser.EnsureWriteScope();
            return idempotency.ExecuteAsync(
                command.IdempotencyKey, "boards.create", command with { IdempotencyKey = null },
                ct => CreateAsync(command, ct), cancellationToken);
        }

        private async Task<BoardDto> CreateAsync(Command command, CancellationToken cancellationToken)
        {
            var now = clock.Now;
            var board = Board.Create(command.Name, command.Description, currentUser.Id, now);
            var keys = new List<string>();
            foreach (var reference in command.ProjectKeys!)
            {
                var grant = await access.EnsureCanWriteAsync(reference, cancellationToken);
                if (board.Links(grant.ProjectId))
                    continue;
                board.LinkProject(grant.ProjectId, currentUser.Id, now);
                keys.Add(grant.ProjectKey);
            }

            db.Boards.Add(board);
            activity.Record(ActivityEntityType.Board, board.Id, null, "board.created", new { board.Name, projects = keys });
            await db.SaveChangesAsync(cancellationToken);
            return await GetBoard.Handler.LoadAsync(db, access, currentUser, board.Id, cancellationToken);
        }
    }
}
