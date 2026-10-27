using Ticketing.Domain.Common;

namespace Ticketing.Domain.Boards;

public sealed class Board
{
    public const int NameMaxLength = 100;
    public const int DescriptionMaxLength = 2000;
    public const int MaxProjects = 20;

    private readonly List<BoardProject> _projects = [];

    private Board()
    {
        Name = null!;
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; }

    public string? Description { get; private set; }

    public Guid OwnerId { get; private set; }

    public DateTimeOffset? ArchivedAt { get; private set; }

    public Guid? ArchivedById { get; private set; }

    public DateTimeOffset? DeletedAt { get; private set; }

    public Guid? DeletedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public uint RowVersion { get; private set; }

    public IReadOnlyList<BoardProject> Projects => _projects;

    public bool IsArchived => ArchivedAt is not null;

    public bool IsDeleted => DeletedAt is not null;

    public static Board Create(string name, string? description, Guid ownerId, DateTimeOffset now) => new()
    {
        Id = EntityId.New(),
        Name = Text.SingleLine(name, "name", NameMaxLength),
        Description = Text.Optional(description, "description", DescriptionMaxLength),
        OwnerId = ownerId,
        CreatedAt = now,
    };

    public void Rename(string name) => Name = Text.SingleLine(name, "name", NameMaxLength);

    public void ChangeDescription(string? description) =>
        Description = Text.Optional(description, "description", DescriptionMaxLength);

    public bool Links(Guid projectId) => _projects.Any(p => p.ProjectId == projectId);

    public void EnsureActive()
    {
        if (IsArchived)
            throw DomainException.Conflict(BoardErrors.Archived, "The board is archived and read-only.", "Unarchive the board first.");
    }

    public void LinkProject(Guid projectId, Guid actorId, DateTimeOffset now)
    {
        EnsureActive();
        if (Links(projectId))
            return;
        if (_projects.Count >= MaxProjects)
            throw DomainException.Conflict(BoardErrors.TooManyProjects, $"A board can link at most {MaxProjects} projects.");
        _projects.Add(BoardProject.Create(Id, projectId, actorId, now));
    }

    /// <summary>
    /// Unlinks a project; the caller moves the project's tickets on this board back to their backlog. A board keeps at
    /// least one linked project (spec 4.13).
    /// </summary>
    public void UnlinkProject(Guid projectId)
    {
        EnsureActive();
        if (!Links(projectId))
            return;
        if (_projects.Count == 1)
            throw DomainException.Conflict(
                BoardErrors.ProjectsRequired, "A board must link at least one project.", "Link another project before unlinking this one, or archive the board.");
        _projects.RemoveAll(p => p.ProjectId == projectId);
    }

    public void TransferOwnership(Guid newOwnerId, bool newOwnerIsActive)
    {
        if (!newOwnerIsActive)
            throw DomainException.Invalid("owner", BoardErrors.OwnerInvalid, "Only an active user can own a board.");
        OwnerId = newOwnerId;
    }

    /// <summary>
    /// Archives the board (I-11). <paramref name="carryOverTarget"/> is the board that receives unfinished tickets, or null
    /// for their project backlogs; use <see cref="BoardCarryOver.Plan"/> to decide where each ticket goes.
    /// </summary>
    public void Archive(Guid actorId, DateTimeOffset now, Board? carryOverTarget = null)
    {
        EnsureActive();
        if (carryOverTarget is not null && (carryOverTarget.Id == Id || carryOverTarget.IsArchived || carryOverTarget.IsDeleted))
            throw DomainException.Invalid(
                "carryOverTo", BoardErrors.CarryOverInvalid, "Unfinished tickets can only be carried over to another active board.",
                "Pick a different, non-archived board, or carry the tickets over to their backlogs.");
        ArchivedAt = now;
        ArchivedById = actorId;
    }

    public void Unarchive()
    {
        ArchivedAt = null;
        ArchivedById = null;
    }

    public void Delete(Guid actorId, DateTimeOffset now)
    {
        if (IsDeleted)
            return;
        DeletedAt = now;
        DeletedById = actorId;
    }
}
