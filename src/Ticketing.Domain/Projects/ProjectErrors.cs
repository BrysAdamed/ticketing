namespace Ticketing.Domain.Projects;

public static class ProjectErrors
{
    public const string NotFound = "project.notFound";
    public const string Forbidden = "project.forbidden";
    public const string KeyInvalid = "project.key.invalid";
    public const string KeyTaken = "project.key.taken";
    public const string NameTaken = "project.name.taken";
    public const string Archived = "project.archived";
    public const string NotArchived = "project.notArchived";
    public const string AlreadyMember = "project.member.exists";
    public const string NotMember = "project.member.notFound";
    public const string LastOwner = "project.lastOwner";
    public const string DeleteNotConfirmed = "project.delete.notConfirmed";
    public const string RepositoryUrlInvalid = "project.repositoryUrl.invalid";
    public const string DefaultBranchInvalid = "project.defaultBranch.invalid";
}
