namespace Ticketing.Domain.Boards;

public sealed class BoardProject
{
    private BoardProject()
    {
    }

    public Guid BoardId { get; private set; }

    public Guid ProjectId { get; private set; }

    public DateTimeOffset AddedAt { get; private set; }

    public Guid AddedById { get; private set; }

    internal static BoardProject Create(Guid boardId, Guid projectId, Guid addedById, DateTimeOffset now) => new()
    {
        BoardId = boardId,
        ProjectId = projectId,
        AddedAt = now,
        AddedById = addedById,
    };
}
