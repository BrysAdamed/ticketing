using System.Text.RegularExpressions;
using Ticketing.Domain.Agents;
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

    /// <summary>Owners opt a project in to agent delegation (spec 13.3); it needs a <see cref="RepositoryUrl"/>.</summary>
    public bool AgentDelegationEnabled { get; private set; }

    public string? RepositoryUrl { get; private set; }

    public AgentMergePolicy AgentMergePolicy { get; private set; } = AgentMergePolicy.Review;

    public string DefaultBranch { get; private set; } = GitBranchName.Default;

    public bool AgentAssignOnDelegate { get; private set; } = true;

    public bool AgentStartProgressOnDelegate { get; private set; } = true;

    public AgentDelegationSettings AgentDelegation =>
        new(AgentDelegationEnabled, RepositoryUrl, DefaultBranch, AgentMergePolicy, AgentAssignOnDelegate, AgentStartProgressOnDelegate);

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

    public void ConfigureAgentDelegation(AgentDelegationSettings settings)
    {
        var url = string.IsNullOrWhiteSpace(settings.RepositoryUrl) ? null : GitRemoteUrl.Parse(settings.RepositoryUrl, "repositoryUrl");
        if (settings.Enabled && url is null)
            throw DomainException.Invalid(
                "enabled", AgentErrors.RepositoryRequired, "Set the repository URL before enabling agent delegation.",
                "Agents check their local clone against it.");
        var branch = GitBranchName.Normalize(settings.DefaultBranch, "defaultBranch");

        AgentDelegationEnabled = settings.Enabled;
        RepositoryUrl = url?.Value;
        DefaultBranch = branch;
        AgentMergePolicy = settings.MergePolicy;
        AgentAssignOnDelegate = settings.AssignOnDelegate;
        AgentStartProgressOnDelegate = settings.StartProgressOnDelegate;
    }

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

    /// <summary>
    /// Makes the project writable again. A non-archived project needs an active Owner (spec 4.3), but its owners may have
    /// been deactivated while it was archived; then the actor (only an Admin can get here) becomes an Owner.
    /// Returns the membership created or promoted for that, or null.
    /// </summary>
    public ProjectMember? Unarchive(Guid actorId, DateTimeOffset now, IReadOnlySet<Guid> activeUserIds)
    {
        if (!IsArchived)
            throw DomainException.Conflict(ProjectErrors.NotArchived, $"Project {Key} is not archived.");
        ArchivedAt = null;
        ArchivedById = null;
        if (HasActiveOwnerOtherThan(null, activeUserIds))
            return null;

        var existing = _members.SingleOrDefault(m => m.UserId == actorId);
        if (existing is null)
            return AddMember(actorId, ProjectRole.Owner, actorId, now);
        existing.ChangeRole(ProjectRole.Owner);
        return existing;
    }

    public void Delete(Guid actorId, DateTimeOffset now, string confirmationKey)
    {
        if (!IsArchived)
            throw DomainException.Conflict(ProjectErrors.NotArchived, "Only archived projects can be deleted.", "Archive the project first.");
        if (!string.Equals(confirmationKey?.Trim(), Key, StringComparison.Ordinal))
            throw DomainException.Invalid("confirmKey", ProjectErrors.DeleteNotConfirmed, $"Type the project key {Key} to confirm the deletion.");
        DeletedAt = now;
        DeletedById = actorId;
    }

    public bool IsMember(Guid userId) => _members.Any(m => m.UserId == userId);

    public ProjectMember AddMember(Guid userId, ProjectRole role, Guid actorId, DateTimeOffset now)
    {
        EnsureWritable();
        if (IsMember(userId))
            throw DomainException.Conflict(ProjectErrors.AlreadyMember, "The user is already a member of this project.");
        var member = ProjectMember.Create(Id, userId, role, actorId, now);
        _members.Add(member);
        return member;
    }

    /// <param name="activeUserIds">Members whose user account is active; only they count as owners (spec 4.3).</param>
    /// <returns>The previous role.</returns>
    public ProjectRole ChangeMemberRole(Guid userId, ProjectRole role, IReadOnlySet<Guid> activeUserIds)
    {
        EnsureWritable();
        var member = FindMember(userId);
        var previous = member.Role;
        if (previous == ProjectRole.Owner && role != ProjectRole.Owner)
            EnsureAnotherActiveOwner(userId, activeUserIds);
        member.ChangeRole(role);
        return previous;
    }

    /// <param name="activeUserIds">Members whose user account is active; only they count as owners (spec 4.3).</param>
    public ProjectMember RemoveMember(Guid userId, IReadOnlySet<Guid> activeUserIds)
    {
        EnsureWritable();
        var member = FindMember(userId);
        if (member.Role == ProjectRole.Owner)
            EnsureAnotherActiveOwner(userId, activeUserIds);
        _members.Remove(member);
        return member;
    }

    private ProjectMember FindMember(Guid userId) =>
        _members.SingleOrDefault(m => m.UserId == userId)
        ?? throw DomainException.Conflict(ProjectErrors.NotMember, "The user is not a member of this project.");

    private bool HasActiveOwnerOtherThan(Guid? userId, IReadOnlySet<Guid> activeUserIds) =>
        _members.Any(m => m.UserId != userId && m.Role == ProjectRole.Owner && activeUserIds.Contains(m.UserId));

    private void EnsureAnotherActiveOwner(Guid userId, IReadOnlySet<Guid> activeUserIds)
    {
        if (!HasActiveOwnerOtherThan(userId, activeUserIds))
            throw DomainException.Conflict(ProjectErrors.LastOwner, "A project must keep at least one active owner.", "Make another active member an Owner first.");
    }

    [GeneratedRegex("^[A-Z][A-Z0-9]{1,9}$", RegexOptions.CultureInvariant)]
    private static partial Regex KeyPattern();
}
