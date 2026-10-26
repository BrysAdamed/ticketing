namespace Ticketing.Domain.Projects;

public sealed class ProjectMember
{
    private ProjectMember()
    {
    }

    public Guid ProjectId { get; private set; }

    public Guid UserId { get; private set; }

    public ProjectRole Role { get; private set; }

    public DateTimeOffset AddedAt { get; private set; }

    public Guid AddedById { get; private set; }

    internal static ProjectMember Create(Guid projectId, Guid userId, ProjectRole role, Guid addedById, DateTimeOffset now) => new()
    {
        ProjectId = projectId,
        UserId = userId,
        Role = role,
        AddedAt = now,
        AddedById = addedById,
    };

    internal void ChangeRole(ProjectRole role) => Role = role;
}
