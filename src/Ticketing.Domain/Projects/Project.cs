using System.Text.RegularExpressions;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Projects;

public sealed partial class Project
{
    public const int KeyMaxLength = 10;
    public const int NameMaxLength = 100;
    public const int DescriptionMaxLength = 10_000;

    private readonly List<ProjectMember> _members = [];

    private Project()
    {
        Key = null!;
        Name = null!;
    }

    public Guid Id { get; private set; }

    public string Key { get; private set; }

    public string Name { get; private set; }

    public string? Description { get; private set; }

    public ProjectVisibility Visibility { get; private set; }

    public DateTimeOffset? ArchivedAt { get; private set; }

    public Guid? ArchivedById { get; private set; }

    public DateTimeOffset? DeletedAt { get; private set; }

    public Guid? DeletedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public Guid CreatedById { get; private set; }

    public uint RowVersion { get; private set; }

    public IReadOnlyList<ProjectMember> Members => _members;

    public bool IsArchived => ArchivedAt is not null;

    public bool IsDeleted => DeletedAt is not null;

    public static Project Create(string key, string name, string? description, ProjectVisibility visibility, Guid creatorId, DateTimeOffset now)
    {
        var project = new Project
        {
            Id = EntityId.New(),
            Key = NormalizeKey(key),
            Name = Text.SingleLine(name, "name", NameMaxLength),
            Description = Text.Optional(description, "description", DescriptionMaxLength),
            Visibility = visibility,
            CreatedAt = now,
            CreatedById = creatorId,
        };
        project._members.Add(ProjectMember.Create(project.Id, creatorId, ProjectRole.Owner, creatorId, now));
        return project;
    }

    public static string NormalizeKey(string? key)
    {
        var normalized = key?.Trim() ?? string.Empty;
        if (!KeyPattern().IsMatch(normalized))
            throw DomainException.Invalid(
                "key", ProjectErrors.KeyInvalid, "Project key must be 2-10 upper-case letters or digits, starting with a letter.",
                "Use something like WEB or CORE2.");
        return normalized;
    }

    public void Rename(string name) => Name = Text.SingleLine(name, "name", NameMaxLength);

    public void ChangeDescription(string? description) =>
        Description = Text.Optional(description, "description", DescriptionMaxLength);

    public void ChangeVisibility(ProjectVisibility visibility) => Visibility = visibility;

    public void EnsureWritable()
    {
        if (IsArchived)
            throw DomainException.Conflict(ProjectErrors.Archived, $"Project {Key} is archived and read-only.", "Unarchive the project first.");
    }

    public void Archive(Guid actorId, DateTimeOffset now)
    {
        EnsureWritable();
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
        if (!IsArchived)
            throw DomainException.Conflict(ProjectErrors.NotArchived, "Only archived projects can be deleted.");
        DeletedAt = now;
        DeletedById = actorId;
    }

    public ProjectMember AddMember(Guid userId, ProjectRole role, Guid actorId, DateTimeOffset now)
    {
        if (_members.Any(m => m.UserId == userId))
            throw DomainException.Conflict(ProjectErrors.AlreadyMember, "The user is already a member of this project.");
        var member = ProjectMember.Create(Id, userId, role, actorId, now);
        _members.Add(member);
        return member;
    }

    public void ChangeMemberRole(Guid userId, ProjectRole role)
    {
        var member = FindMember(userId);
        if (member.Role == ProjectRole.Owner && role != ProjectRole.Owner)
            EnsureAnotherOwner(userId);
        member.ChangeRole(role);
    }

    public void RemoveMember(Guid userId)
    {
        var member = FindMember(userId);
        if (member.Role == ProjectRole.Owner)
            EnsureAnotherOwner(userId);
        _members.Remove(member);
    }

    private ProjectMember FindMember(Guid userId) =>
        _members.SingleOrDefault(m => m.UserId == userId)
        ?? throw DomainException.Conflict(ProjectErrors.NotMember, "The user is not a member of this project.");

    private void EnsureAnotherOwner(Guid userId)
    {
        if (!_members.Any(m => m.UserId != userId && m.Role == ProjectRole.Owner))
            throw DomainException.Conflict(ProjectErrors.LastOwner, "A project must keep at least one owner.", "Add another owner first.");
    }

    [GeneratedRegex("^[A-Z][A-Z0-9]{1,9}$", RegexOptions.CultureInvariant)]
    private static partial Regex KeyPattern();
}
