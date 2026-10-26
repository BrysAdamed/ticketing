using Ticketing.Domain.Common;
using Ticketing.Domain.Ordering;

namespace Ticketing.Domain.Tickets;

public sealed class Ticket
{
    public const int TitleMaxLength = 255;
    public const int DescriptionMaxLength = 50_000;
    public const int VersionMaxLength = 50;
    public const int MaxStoryPoints = 100;

    private Ticket()
    {
        Title = null!;
        Rank = null!;
        Labels = [];
    }

    public Guid Id { get; private set; }

    public Guid ProjectId { get; private set; }

    public int Number { get; private set; }

    public string Title { get; private set; }

    public string? Description { get; private set; }

    public TicketType Type { get; private set; }

    public TicketStatus Status { get; private set; }

    public Resolution? Resolution { get; private set; }

    public Priority Priority { get; private set; }

    public Severity? Severity { get; private set; }

    public int? StoryPoints { get; private set; }

    public string? Version { get; private set; }

    public List<string> Labels { get; private set; }

    public Guid? ParentId { get; private set; }

    /// <summary>Null means the ticket is in its project backlog.</summary>
    public Guid? BoardId { get; private set; }

    public string Rank { get; private set; }

    public Guid? AssigneeId { get; private set; }

    public Guid ReporterId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public Guid CreatedById { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset StatusChangedAt { get; private set; }

    public DateTimeOffset? ResolvedAt { get; private set; }

    public DateTimeOffset? DeletedAt { get; private set; }

    public Guid? DeletedById { get; private set; }

    public uint RowVersion { get; private set; }

    public bool IsDeleted => DeletedAt is not null;

    public bool IsInBacklog => BoardId is null;

    public static Ticket Create(Guid projectId, int number, string title, TicketType type, Guid createdById, string rank, DateTimeOffset now) => new()
    {
        Id = EntityId.New(),
        ProjectId = projectId,
        Number = number,
        Title = Text.SingleLine(title, "title", TitleMaxLength),
        Type = type,
        Status = TicketStatus.ToDo,
        Priority = Priority.Medium,
        Labels = [],
        Rank = Ranks.Validate(rank),
        ReporterId = createdById,
        CreatedAt = now,
        CreatedById = createdById,
        UpdatedAt = now,
        StatusChangedAt = now,
    };

    public string KeyIn(string projectKey) => HumanKeys.Ticket(projectKey, Number);

    public void Rename(string title) => Title = Text.SingleLine(title, "title", TitleMaxLength);

    public void ChangeDescription(string? description) =>
        Description = Text.Optional(description, "description", DescriptionMaxLength);

    public void ChangeType(TicketType type)
    {
        TicketHierarchy.EnsureCanChangeType(this, type);
        Type = type;
    }

    /// <summary>Applies the status side effects of spec 6.2. Transitions are free (any to any).</summary>
    public StatusChange ChangeStatus(TicketStatus status, Resolution? resolution, DateTimeOffset now)
    {
        var change = new StatusChange(Status, status);
        if (status != TicketStatus.Done && resolution is not null)
            throw DomainException.Invalid("resolution", TicketErrors.ResolutionWithoutDone, "A resolution can only be set when the status is Done.");

        if (change.EntersDone)
        {
            ResolvedAt = now;
            Resolution = resolution ?? Tickets.Resolution.Done;
        }
        else if (change.LeavesDone)
        {
            ResolvedAt = null;
            Resolution = null;
        }
        else if (status == TicketStatus.Done && resolution is not null)
        {
            Resolution = resolution;
        }

        if (change.Changed)
            StatusChangedAt = now;
        Status = status;
        return change;
    }

    public void ChangePriority(Priority priority) => Priority = priority;

    public void ChangeSeverity(Severity? severity) => Severity = severity;

    public void ChangeStoryPoints(int? storyPoints)
    {
        if (storyPoints is < 0 or > MaxStoryPoints)
            throw DomainException.Invalid("storyPoints", TicketErrors.StoryPointsOutOfRange, $"Story points must be between 0 and {MaxStoryPoints}.");
        StoryPoints = storyPoints;
    }

    public void ChangeVersion(string? version) => Version = Text.Optional(version, "version", VersionMaxLength);

    public void ReplaceLabels(IEnumerable<string?>? labels) => Labels = TicketLabels.Normalize(labels);

    public void EditLabels(IEnumerable<string?>? add, IEnumerable<string?>? remove) => Labels = TicketLabels.Edit(Labels, add, remove);

    public void SetParent(Ticket parent, IReadOnlyCollection<Guid> parentAncestorIds, int subtreeHeight)
    {
        TicketHierarchy.EnsureCanSetParent(this, parent, parentAncestorIds, subtreeHeight);
        ParentId = parent.Id;
    }

    public void ClearParent() => ParentId = null;

    public void AssignTo(Guid? assigneeId) => AssigneeId = assigneeId;

    public void ChangeReporter(Guid reporterId) => ReporterId = reporterId;

    public void MoveToBacklog(string rank)
    {
        BoardId = null;
        Rank = Ranks.Validate(rank);
    }

    public void PlaceOnBoard(Guid boardId, string rank)
    {
        BoardId = boardId;
        Rank = Ranks.Validate(rank);
    }

    public void Rerank(string rank) => Rank = Ranks.Validate(rank);

    /// <summary>Bumps UpdatedAt; call once per user operation that changed the ticket, its comments, links or attachments.</summary>
    public void Touch(DateTimeOffset now) => UpdatedAt = now;

    public void Delete(Guid actorId, DateTimeOffset now)
    {
        if (IsDeleted)
            return;
        DeletedAt = now;
        DeletedById = actorId;
        BoardId = null;
    }
}

public readonly record struct StatusChange(TicketStatus From, TicketStatus To)
{
    public bool Changed => From != To;

    public bool EntersDone => To == TicketStatus.Done && From != TicketStatus.Done;

    public bool LeavesDone => From == TicketStatus.Done && To != TicketStatus.Done;
}
