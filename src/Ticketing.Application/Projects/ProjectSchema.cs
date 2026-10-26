namespace Ticketing.Application.Projects;

/// <summary>Database names the project use cases rely on; the EF configuration uses the same constants.</summary>
public static class ProjectSchema
{
    /// <summary>Shadow property: <c>lower(name)</c>, stored, uniquely indexed among non-deleted projects.</summary>
    public const string NameNormalized = "NameNormalized";

    public const string NameUniqueIndex = "ix_projects_name_active";

    public const string KeyUniqueIndex = "ix_projects_key";
}
